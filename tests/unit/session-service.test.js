import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionService } from '../../src/server/services/session-service.js';

function sessionToken(sessionId, { iat = 100, sub = 'seller-1' } = {}) {
  return `header.${Buffer.from(JSON.stringify({ iat, sub, session_id: sessionId })).toString('base64url')}.signature`;
}

function profileClient({ usernameProfile, actorProfile }) {
  const queries = [];
  return {
    queries,
    from(table) {
      if (table === 'app_session_registry') {
        return { upsert: async () => ({ error: null }) };
      }
      assert.equal(table, 'profiles');
      const filters = [];
      const query = {
        select(columns) {
          assert.equal(columns, 'id, email, username, display_name, role, active, session_not_before');
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          queries.push(filters);
          const profile = filters.some(([column]) => column === 'username_normalized')
            ? usernameProfile
            : actorProfile;
          return { data: profile, error: null };
        },
      };
      return query;
    },
  };
}

test('login resolves a normalized username, verifies Auth identity, and reloads the active actor', async () => {
  const adminClient = profileClient({
    usernameProfile: {
      id: 'seller-1',
      email: 'seller@example.com',
      username: 'seller',
      display_name: 'Vendas SP',
      role: 'seller',
      active: true,
      session_not_before: '1970-01-01T00:00:00.000Z',
    },
    actorProfile: {
      id: 'seller-1',
      email: 'seller@example.com',
      username: 'seller',
      display_name: 'Vendas SP',
      role: 'seller',
      active: true,
      session_not_before: '1970-01-01T00:00:00.000Z',
    },
  });
  const session = {
    access_token: sessionToken('ad6b269c-2d4a-42ae-b468-7d5ec7be9d16'),
    refresh_token: 'refresh-1',
    expires_at: 123,
  };
  const authClient = {
    auth: {
      async signInWithPassword(input) {
        assert.deepEqual(input, { email: 'seller@example.com', password: 'SenhaSegura123!' });
        return { data: { session }, error: null };
      },
      async getUser(token) {
        assert.equal(token, session.access_token);
        return { data: { user: { id: 'seller-1' } }, error: null };
      },
    },
  };

  const result = await createSessionService({ authClient, adminClient }).login({
    identifier: ' SELLER ',
    password: 'SenhaSegura123!',
  });

  assert.deepEqual(result, {
    session,
    actor: {
      id: 'seller-1',
      role: 'seller',
      name: 'Vendas SP',
      username: 'seller',
      active: true,
    },
  });
  assert.deepEqual(adminClient.queries, [
    [['username_normalized', 'seller'], ['active', true]],
    [['id', 'seller-1'], ['active', true]],
  ]);
});

test('login records the verified UUID session without reactivating an existing registry row', async () => {
  const sessionId = 'b6d6903e-583d-406e-ae5a-f2b8a25f3d2c';
  const registryUpserts = [];
  const session = {
    access_token: sessionToken(sessionId),
    refresh_token: 'refresh-1',
    expires_at: 123,
  };
  const service = createSessionService({
    authClient: {
      auth: {
        async signInWithPassword(input) {
          assert.deepEqual(input, { email: 'seller@example.com', password: 'SenhaSegura123!' });
          return { data: { session }, error: null };
        },
        async getUser(token) {
          assert.equal(token, session.access_token);
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient: {
      from(table) {
        if (table === 'app_session_registry') {
          return {
            async upsert(row, options) {
              registryUpserts.push({ row, options });
              return { error: null };
            },
          };
        }
        assert.equal(table, 'profiles');
        const query = {
          select(columns) {
            assert.equal(columns, 'id, email, username, display_name, role, active, session_not_before');
            return query;
          },
          eq() {
            return query;
          },
          async maybeSingle() {
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
  });

  await service.login({ identifier: 'seller@example.com', password: 'SenhaSegura123!' });

  assert.deepEqual(registryUpserts, [{
    row: { session_id: sessionId, user_id: 'seller-1' },
    options: { onConflict: 'session_id', ignoreDuplicates: true },
  }]);
});

test('refresh rotates the Supabase session and reloads the active actor', async () => {
  const adminClient = profileClient({
    actorProfile: {
      id: 'seller-1',
      email: 'seller@example.com',
      username: 'seller',
      display_name: 'Vendas SP',
      role: 'seller',
      active: true,
      session_not_before: '1970-01-01T00:00:00.000Z',
    },
  });
  const session = {
    access_token: sessionToken('91c39b9a-1c61-4e5a-bd90-d96bfc14effc'),
    refresh_token: 'refresh-2',
    expires_at: 456,
  };
  const service = createSessionService({
    authClient: {
      auth: {
        async refreshSession(input) {
          assert.deepEqual(input, { refresh_token: 'refresh-1' });
          return { data: { session }, error: null };
        },
        async getUser(token) {
          assert.equal(token, session.access_token);
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient,
  });

  assert.deepEqual(await service.refresh({ refreshToken: 'refresh-1' }), {
    session,
    actor: {
      id: 'seller-1',
      role: 'seller',
      name: 'Vendas SP',
      username: 'seller',
      active: true,
    },
  });
  assert.deepEqual(adminClient.queries, [[['id', 'seller-1'], ['active', true]]]);
});

test('refresh rejects a session issued before the profile session floor', async () => {
  const adminClient = profileClient({
    actorProfile: {
      id: 'seller-1',
      email: 'seller@example.com',
      username: 'seller',
      display_name: 'Vendas SP',
      role: 'seller',
      active: true,
      session_not_before: '2026-09-08T12:00:00.000Z',
    },
  });
  const session = {
    access_token: sessionToken('91c39b9a-1c61-4e5a-bd90-d96bfc14effc', { iat: 100 }),
    refresh_token: 'refresh-2',
    expires_at: 456,
  };
  const service = createSessionService({
    authClient: {
      auth: {
        async refreshSession() {
          return { data: { session }, error: null };
        },
        async getUser() {
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient,
  });

  await assert.rejects(
    () => service.refresh({ refreshToken: 'refresh-1' }),
    (error) => error.status === 401 && error.code === 'INVALID_LOGIN',
  );
  assert.deepEqual(adminClient.queries, [[['id', 'seller-1'], ['active', true]]]);
});

test('logout revokes the supplied authenticated session and advances its session floor', async () => {
  const calls = [];
  const timestamp = new Date('2026-09-08T12:00:00.000Z');
  const service = createSessionService({
    authClient: {
      auth: {
        async getUser(token) {
          calls.push(['getUser', token]);
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient: {
      auth: {
        admin: {
          async signOut(token, scope) {
            calls.push(['signOut', token, scope]);
            return { data: null, error: null };
          },
        },
      },
      from(table) {
        assert.equal(table, 'profiles');
        return {
          update(input) {
            calls.push(['update', input]);
            return {
              async eq(column, value) {
                calls.push(['eq', column, value]);
                return { error: null };
              },
            };
          },
        };
      },
    },
    now: () => timestamp,
  });

  await service.logout({ token: 'access-1' });

  assert.deepEqual(calls, [
    ['getUser', 'access-1'],
    ['signOut', 'access-1', 'global'],
    ['update', { session_not_before: '2026-09-08T12:00:00.000Z' }],
    ['eq', 'id', 'seller-1'],
  ]);
});

test('confirmPassword verifies the active actor identity without retaining the password', async () => {
  const calls = [];
  const service = createSessionService({
    authClient: {
      auth: {
        async signInWithPassword(input) {
          calls.push(['signInWithPassword', input]);
          return { data: { user: { id: 'admin-1' } }, error: null };
        },
      },
    },
    adminClient: {
      from(table) {
        assert.equal(table, 'profiles');
        const query = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() {
            calls.push(['maybeSingle']);
            return {
              data: {
                id: 'admin-1', email: 'admin@users.galaxy-smart.invalid', username: 'admin',
                display_name: 'Admin', role: 'admin', active: true,
              },
              error: null,
            };
          },
        };
        return query;
      },
    },
  });

  await service.confirmPassword({ id: 'admin-1', password: '123456' });

  assert.deepEqual(calls, [
    ['maybeSingle'],
    ['signInWithPassword', { email: 'admin@users.galaxy-smart.invalid', password: '123456' }],
  ]);
});

test('confirmPassword fails closed for an invalid credential or mismatched Auth identity', async () => {
  for (const authResult of [
    { data: { user: null }, error: new Error('invalid credential') },
    { data: { user: { id: 'other-user' } }, error: null },
  ]) {
    const service = createSessionService({
      authClient: { auth: { signInWithPassword: async () => authResult } },
      adminClient: {
        from: () => {
          const query = {
            select() { return query; },
            eq() { return query; },
            async maybeSingle() {
              return {
                data: {
                  id: 'admin-1', email: 'admin@users.galaxy-smart.invalid', username: 'admin',
                  display_name: 'Admin', role: 'admin', active: true,
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
      () => service.confirmPassword({ id: 'admin-1', password: 'wrong' }),
      (error) => error.status === 400
        && error.code === 'INVALID_CURRENT_PASSWORD'
        && error.message === 'Senha atual inválida.',
    );
  }
});

test('changePassword verifies the current credential before updating Auth and advancing the session floor', async () => {
  const calls = [];
  const service = createSessionService({
    authClient: {
      auth: {
        async signInWithPassword(input) {
          calls.push(['signInWithPassword', input]);
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient: {
      auth: {
        admin: {
          async updateUserById(id, input) {
            calls.push(['updateUserById', id, input]);
            return { data: { user: { id } }, error: null };
          },
        },
      },
      from(table) {
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
            calls.push(['maybeSingle', filters]);
            return {
              data: {
                id: 'seller-1',
                email: 'seller@example.com',
                username: 'seller',
                display_name: 'Vendas SP',
                role: 'seller',
                active: true,
              },
              error: null,
            };
          },
          update(input) {
            calls.push(['update', input]);
            return {
              async eq(column, value) {
                calls.push(['updateEq', column, value]);
                return { error: null };
              },
            };
          },
        };
        return query;
      },
    },
    now: () => new Date('2026-09-08T13:00:00.000Z'),
  });

  await service.changePassword({
    id: 'seller-1',
    currentPassword: 'SenhaAtual123!',
    newPassword: 'NovaSenhaSegura123!',
  });

  assert.deepEqual(calls, [
    ['maybeSingle', [['id', 'seller-1'], ['active', true]]],
    ['signInWithPassword', { email: 'seller@example.com', password: 'SenhaAtual123!' }],
    ['updateUserById', 'seller-1', { password: 'NovaSenhaSegura123!' }],
    ['update', { session_not_before: '2026-09-08T13:00:00.000Z' }],
    ['updateEq', 'id', 'seller-1'],
  ]);
});

test('changePassword fails closed when it cannot advance session_not_before', async () => {
  const profileUpdateError = new Error('profile update failed');
  let profilesRead = false;
  const service = createSessionService({
    authClient: {
      auth: {
        async signInWithPassword() {
          return { data: { user: { id: 'seller-1' } }, error: null };
        },
      },
    },
    adminClient: {
      auth: {
        admin: {
          async updateUserById() {
            return { data: { user: { id: 'seller-1' } }, error: null };
          },
        },
      },
      from() {
        if (!profilesRead) {
          profilesRead = true;
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
                  email: 'seller@example.com',
                  username: 'seller',
                  display_name: 'Vendas SP',
                  role: 'seller',
                  active: true,
                },
                error: null,
              };
            },
          };
          return query;
        }
        return {
          update() {
            return {
              async eq() {
                return { error: profileUpdateError };
              },
            };
          },
        };
      },
    },
  });

  await assert.rejects(
    () => service.changePassword({
      id: 'seller-1',
      currentPassword: 'SenhaAtual123!',
      newPassword: 'NovaSenhaSegura123!',
    }),
    profileUpdateError,
  );
});
