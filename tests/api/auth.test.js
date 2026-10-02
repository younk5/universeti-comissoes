import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import { createAuthenticateRequest, requireAdmin } from '../../src/server/middleware/auth.js';

const productionConfig = {
  nodeEnv: 'production',
  sessionCookieName: '__Host-galaxy-smart-refresh',
  secureCookies: true,
};

const actor = {
  id: 'seller-1',
  role: 'seller',
  name: 'Vendas SP',
  username: 'seller',
  active: true,
};

function tokenIssuedAt(iat, extraClaims = {}) {
  return `header.${Buffer.from(JSON.stringify({
    sub: 'seller-1',
    iat,
    session_id: '9d7695ce-34fe-4c47-9b8b-ee61620d7341',
    ...extraClaims,
  })).toString('base64url')}.signature`;
}

function registeredSessionQuery() {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    is() {
      return query;
    },
    async maybeSingle() {
      return { data: { session_id: '9d7695ce-34fe-4c47-9b8b-ee61620d7341' }, error: null };
    },
    async upsert() {
      return { error: null };
    },
  };
  return query;
}

test('middleware rejects a verified token issued before session_not_before', async () => {
  const authenticateRequest = createAuthenticateRequest({
    authClient: {
      auth: {
        async getUser(token) {
          assert.equal(token, tokenIssuedAt(100));
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient: {
      from(table) {
        if (table === 'app_session_registry') return registeredSessionQuery();
        assert.equal(table, 'profiles');
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          async maybeSingle() {
            return {
              data: {
                id: 'seller-1',
                username: 'seller',
                display_name: 'Vendas SP',
                role: 'seller',
                active: true,
                session_not_before: '1970-01-01T00:02:00.000Z',
              },
              error: null,
            };
          },
        };
        return query;
      },
    },
    now: () => new Date(200_000),
  });

  await assert.rejects(
    () => authenticateRequest({ token: tokenIssuedAt(100) }),
    /sessão expirada/i,
  );
});

test('middleware rejects a verified token without a matching unrevoked registry session', async () => {
  const authenticateRequest = createAuthenticateRequest({
    authClient: {
      auth: {
        async getUser() {
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient: {
      from(table) {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          is() {
            return query;
          },
          async maybeSingle() {
            return table === 'app_session_registry'
              ? { data: null, error: null }
              : {
                data: {
                  id: 'seller-1',
                  username: 'seller',
                  display_name: 'Vendas SP',
                  role: 'seller',
                  active: true,
                  session_not_before: '1970-01-01T00:00:00.000Z',
                },
                error: null,
              };
          },
        };
        return query;
      },
    },
  });

  await assert.rejects(
    () => authenticateRequest({ token: tokenIssuedAt(100) }),
    /unauthorized|sessão/i,
  );
});

test('middleware derives role and active status from the verified profile instead of JWT claims', async () => {
  const authenticateRequest = createAuthenticateRequest({
    authClient: {
      auth: {
        async getUser() {
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient: {
      from(table) {
        if (table === 'app_session_registry') return registeredSessionQuery();
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          async maybeSingle() {
            return {
              data: {
                id: 'seller-1',
                username: 'seller',
                display_name: 'Vendas SP',
                role: 'seller',
                active: true,
                session_not_before: '1970-01-01T00:00:00.000Z',
              },
              error: null,
            };
          },
        };
        return query;
      },
    },
  });

  assert.deepEqual(
    await authenticateRequest({ token: tokenIssuedAt(100, { role: 'admin', user_metadata: { role: 'admin' } }) }),
    actor,
  );
});

test('app removes public configuration and limits browser connections to same origin', async () => {
  const app = createApp({ services: {}, config: { nodeEnv: 'test' } });
  const [health, publicConfig] = await Promise.all([
    request(app).get('/health'),
    request(app).get('/api/public-config'),
  ]);

  assert.equal(publicConfig.status, 404);
  assert.match(health.headers['content-security-policy'], /connect-src 'self'/);
  assert.doesNotMatch(health.headers['content-security-policy'], /googleapis|supabase/i);
});

test('login stores only the refresh token in an HttpOnly same-site cookie', async () => {
  const app = createApp({
    config: productionConfig,
    services: {
      session: {
        async login(input) {
          assert.deepEqual(input, { identifier: 'seller', password: 'SenhaSegura123!' });
          return {
            session: {
              access_token: 'access-1',
              refresh_token: 'refresh-1',
              expires_at: 123,
            },
            actor,
          };
        },
      },
    },
  });

  const response = await request(app)
    .post('/api/auth/login')
    .send({ identifier: 'seller', password: 'SenhaSegura123!' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { accessToken: 'access-1', expiresAt: 123, actor });
  assert.equal(response.body.refreshToken, undefined);
  assert.match(response.headers['set-cookie'][0], /^__Host-galaxy-smart-refresh=refresh-1;/);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  assert.match(response.headers['set-cookie'][0], /Secure/);
  assert.match(response.headers['set-cookie'][0], /Path=\//);
  assert.doesNotMatch(response.headers['set-cookie'][0], /Domain=/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('app composes Supabase clients into the server session service', async () => {
  const accessToken = tokenIssuedAt(100);
  const app = createApp({
    config: productionConfig,
    services: {
      authClient: {
        auth: {
          async signInWithPassword(input) {
            assert.deepEqual(input, { email: 'seller@example.com', password: 'SenhaSegura123!' });
            return {
              data: {
                session: {
                  access_token: accessToken,
                  refresh_token: 'refresh-1',
                  expires_at: 123,
                },
              },
              error: null,
            };
          },
          async getUser(token) {
            assert.equal(token, accessToken);
            return { data: { user: { id: 'seller-1' } }, error: null };
          },
        },
      },
      adminClient: {
        from(table) {
          if (table === 'app_session_registry') return registeredSessionQuery();
        assert.equal(table, 'profiles');
          const filters = [];
          const query = {
            select() {
              return query;
            },
            eq(column, value) {
              filters.push([column, value]);
              return query;
            },
            async maybeSingle() {
              if (filters[0][0] === 'username_normalized') {
                assert.deepEqual(filters, [
                  ['username_normalized', 'seller'],
                  ['active', true],
                ]);
              } else {
                assert.deepEqual(filters, [
                  ['id', 'seller-1'],
                  ['active', true],
                ]);
              }
              return {
                data: {
                  id: 'seller-1',
                  email: 'seller@example.com',
                  username: 'seller',
                  display_name: 'Vendas SP',
                  role: 'seller',
                  active: true,
                  session_not_before: '1970-01-01T00:00:00.000Z',
                },
                error: null,
              };
            },
          };
          return query;
        },
      },
    },
  });

  const response = await request(app)
    .post('/api/auth/login')
    .send({ identifier: 'seller', password: 'SenhaSegura123!' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { accessToken, expiresAt: 123, actor });
});

test('refresh rotates the cookie and never serializes its refresh token', async () => {
  const app = createApp({
    config: productionConfig,
    services: {
      session: {
        async refresh(input) {
          assert.deepEqual(input, { refreshToken: 'refresh-1' });
          return {
            session: {
              access_token: 'access-2',
              refresh_token: 'refresh-2',
              expires_at: 456,
            },
            actor,
          };
        },
      },
    },
  });

  const response = await request(app)
    .post('/api/auth/refresh')
    .set('Cookie', '__Host-galaxy-smart-refresh=refresh-1');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { accessToken: 'access-2', expiresAt: 456, actor });
  assert.equal(response.body.refreshToken, undefined);
  assert.match(response.headers['set-cookie'][0], /^__Host-galaxy-smart-refresh=refresh-2;/);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  assert.match(response.headers['set-cookie'][0], /Secure/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('refresh without a usable cookie clears it and returns a generic session error', async () => {
  const app = createApp({
    config: productionConfig,
    services: {
      session: {
        async refresh(input) {
          assert.deepEqual(input, { refreshToken: undefined });
          throw new Error('refresh token rejected');
        },
      },
    },
  });

  const response = await request(app).post('/api/auth/refresh');

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { message: 'Sessão inválida ou expirada.', code: 'UNAUTHORIZED' });
  assert.match(response.headers['set-cookie'][0], /^__Host-galaxy-smart-refresh=;/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('logout clears the refresh cookie after a best-effort session revocation', async () => {
  const app = createApp({
    config: productionConfig,
    services: {
      session: {
        async logout(input) {
          assert.deepEqual(input, { token: 'access-1' });
          throw new Error('remote unavailable');
        },
      },
    },
  });

  const response = await request(app)
    .post('/api/auth/logout')
    .set('Authorization', 'Bearer access-1');

  assert.equal(response.status, 204);
  assert.match(response.headers['set-cookie'][0], /^__Host-galaxy-smart-refresh=;/);
  assert.match(response.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  assert.match(response.headers['set-cookie'][0], /Secure/);
  assert.match(response.headers['set-cookie'][0], /Path=\//);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('password change uses the authenticated actor instead of a caller-supplied identity', async () => {
  const calls = [];
  const app = createApp({
    config: productionConfig,
    services: {
      authenticateRequest: async ({ token }) => {
        assert.equal(token, 'access-1');
        return actor;
      },
      session: {
        async changePassword(input) {
          calls.push(input);
        },
      },
    },
  });

  const response = await request(app)
    .post('/api/auth/password')
    .set('Authorization', 'Bearer access-1')
    .send({ currentPassword: 'SenhaAtual123!', newPassword: 'NovaSenhaSegura123!', id: 'admin-1' });

  assert.equal(response.status, 204);
  assert.deepEqual(calls, [{
    id: 'seller-1',
    currentPassword: 'SenhaAtual123!',
    newPassword: 'NovaSenhaSegura123!',
  }]);
  assert.equal(response.headers['cache-control'], 'no-store');
});
