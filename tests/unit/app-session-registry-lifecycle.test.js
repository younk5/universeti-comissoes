import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthenticateRequest } from '../../src/server/middleware/auth.js';
import { createSessionService } from '../../src/server/services/session-service.js';
import { createUserService } from '../../src/server/services/user-service.js';

const sellerId = '1a4d7ee6-17de-4ee3-9e94-fa297516bf68';
const admin = { id: 'admin-1', role: 'admin', active: true };

function token(sessionId) {
  return `header.${Buffer.from(JSON.stringify({ sub: sellerId, iat: 100, session_id: sessionId })).toString('base64url')}.signature`;
}

test('a session created before disable stays rejected after reactivation while a new login is accepted', async () => {
  const oldSessionId = 'a9d61da1-5111-4c23-a2c4-7381f3664720';
  const newSessionId = 'cc1d7d49-b4a9-4fe6-a64b-0e1eb2a95d9d';
  const profile = {
    id: sellerId,
    email: 'seller@example.com',
    username: 'seller',
    display_name: 'Vendas SP',
    role: 'seller',
    active: true,
    session_not_before: '1970-01-01T00:00:00.000Z',
  };
  const registry = new Map([[oldSessionId, {
    session_id: oldSessionId,
    user_id: sellerId,
    revoked_at: null,
  }]]);
  const adminClient = {
    auth: {
      admin: {
        async updateUserById() {
          return { data: { user: { id: sellerId } }, error: null };
        },
      },
    },
    from(table) {
      if (table === 'profiles') {
        const query = {
          select() {
            return query;
          },
          update(row) {
            Object.assign(profile, row);
            return query;
          },
          eq() {
            return query;
          },
          async maybeSingle() {
            return { data: { ...profile }, error: null };
          },
        };
        return query;
      }

      assert.equal(table, 'app_session_registry');
      const filters = new Map();
      let update;
      const query = {
        select() {
          return query;
        },
        update(row) {
          update = row;
          return query;
        },
        eq(column, value) {
          filters.set(column, value);
          return query;
        },
        is(column, value) {
          filters.set(column, value);
          return query;
        },
        async upsert(row, options) {
          assert.deepEqual(options, { onConflict: 'session_id', ignoreDuplicates: true });
          if (!registry.has(row.session_id)) registry.set(row.session_id, { ...row, revoked_at: null });
          return { error: null };
        },
        async maybeSingle() {
          const row = registry.get(filters.get('session_id'));
          const matches = row
            && row.user_id === filters.get('user_id')
            && (filters.get('revoked_at') !== null || row.revoked_at === null);
          return { data: matches ? { session_id: row.session_id } : null, error: null };
        },
        then(resolve, reject) {
          for (const row of registry.values()) {
            if (row.user_id === filters.get('user_id') && row.revoked_at === null) Object.assign(row, update);
          }
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const authClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: sellerId } }, error: null };
      },
      async signInWithPassword(input) {
        assert.deepEqual(input, { email: 'seller@example.com', password: 'SenhaSegura123!' });
        return {
          data: {
            session: {
              access_token: token(newSessionId),
              refresh_token: 'refresh-2',
              expires_at: 456,
            },
          },
          error: null,
        };
      },
    },
  };
  const authenticateRequest = createAuthenticateRequest({ authClient, adminClient });
  const users = createUserService({
    adminClient,
    now: () => new Date('1970-01-01T00:01:40.000Z'),
  });
  const sessions = createSessionService({ authClient, adminClient });

  await users.setSellerActive(sellerId, false, admin);
  await users.setSellerActive(sellerId, true, admin);

  await assert.rejects(() => authenticateRequest({ token: token(oldSessionId) }));
  await sessions.login({ identifier: 'seller@example.com', password: 'SenhaSegura123!' });
  assert.deepEqual(await authenticateRequest({ token: token(newSessionId) }), {
    id: sellerId,
    role: 'seller',
    name: 'Vendas SP',
    username: 'seller',
    active: true,
  });
});
