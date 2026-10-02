import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin, FIRST_ADMIN_LEASE_DURATION_MS } from '../../scripts/bootstrap-admin.js';

function bootstrapEnvironment() {
  return {
    BOOTSTRAP_ADMIN_NAME: ' Admin Principal ',
    BOOTSTRAP_ADMIN_EMAIL: ' ADMIN@EXEMPLO.COM ',
    BOOTSTRAP_ADMIN_USERNAME: ' Admin.Principal ',
    BOOTSTRAP_ADMIN_PASSWORD: 'senha-inicial-segura',
  };
}

function fakeAdminClient({
  existingAdmins = [], lockError = null, profileError = null, deleteUserError = null,
} = {}) {
  const authCalls = [];
  const deletedUsers = [];
  const profileInserts = [];
  const lockInserts = [];
  const lockDeleteFilters = [];

  function lockDeleteQuery() {
    const query = {
      eq: (field, value) => {
        lockDeleteFilters.push([field, value]);
        return query;
      },
      lte: (field, value) => {
        lockDeleteFilters.push([field, value]);
        return Promise.resolve({ error: null });
      },
    };
    return query;
  }

  const adminClient = {
    auth: {
      admin: {
        createUser: async (input) => {
          authCalls.push(input);
          return { data: { user: { id: 'admin-auth-id' } }, error: null };
        },
        deleteUser: async (id) => {
          deletedUsers.push(id);
          return { error: deleteUserError };
        },
      },
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => {
            const query = {
              eq: () => query,
              limit: () => Promise.resolve({ data: existingAdmins, error: null }),
            };
            return query;
          },
          insert: async (row) => {
            profileInserts.push(row);
            return { error: profileError };
          },
        };
      }
      assert.equal(table, 'bootstrap_locks');
      return {
        delete: () => lockDeleteQuery(),
        insert: async (row) => {
          lockInserts.push(row);
          return { error: lockError };
        },
      };
    },
  };

  return {
    adminClient, authCalls, deletedUsers, profileInserts, lockInserts, lockDeleteFilters,
  };
}

test('bootstrap creates the only administrator behind a Supabase lease', async () => {
  const fake = fakeAdminClient();
  const now = new Date('2026-09-08T16:00:00.000Z');
  const result = await bootstrapAdmin({
    env: bootstrapEnvironment(),
    readConfiguration: () => ({ supabaseUrl: 'https://project.supabase.co' }),
    createServices: () => ({ adminClient: fake.adminClient }),
    now: () => now,
    createLeaseOwnerToken: () => 'c2609b28-c4e3-41cb-9246-7cc2e2ecd6f2',
  });

  assert.deepEqual(fake.authCalls, [{
    email: 'admin@exemplo.com', password: 'senha-inicial-segura', email_confirm: true,
  }]);
  assert.deepEqual(fake.lockInserts, [{
    scope: 'first-admin',
    owner_token: 'c2609b28-c4e3-41cb-9246-7cc2e2ecd6f2',
    lease_expires_at: new Date(now.getTime() + FIRST_ADMIN_LEASE_DURATION_MS).toISOString(),
  }]);
  assert.deepEqual(fake.profileInserts, [{
    id: 'admin-auth-id',
    email: 'admin@exemplo.com',
    username: 'Admin.Principal',
    username_normalized: 'admin.principal',
    display_name: 'Admin Principal',
    role: 'admin',
    active: true,
  }]);
  assert.deepEqual(fake.lockDeleteFilters, [
    ['scope', 'first-admin'],
    ['lease_expires_at', now.toISOString()],
    ['scope', 'first-admin'],
    ['owner_token', 'c2609b28-c4e3-41cb-9246-7cc2e2ecd6f2'],
  ]);
  assert.deepEqual(result, { id: 'admin-auth-id', role: 'admin', name: 'Admin Principal', active: true });
});

test('bootstrap deletes the Auth identity and releases its lease when profile insertion fails', async () => {
  const fake = fakeAdminClient({ profileError: new Error('profile db down') });

  await assert.rejects(
    () => bootstrapAdmin({
      env: bootstrapEnvironment(),
      readConfiguration: () => ({}),
      createServices: () => ({ adminClient: fake.adminClient }),
      now: () => new Date('2026-09-08T16:00:00.000Z'),
      createLeaseOwnerToken: () => 'c2609b28-c4e3-41cb-9246-7cc2e2ecd6f2',
    }),
    /profile db down/,
  );

  assert.deepEqual(fake.deletedUsers, ['admin-auth-id']);
  assert.deepEqual(fake.lockDeleteFilters.slice(-2), [
    ['scope', 'first-admin'],
    ['owner_token', 'c2609b28-c4e3-41cb-9246-7cc2e2ecd6f2'],
  ]);
});

test('bootstrap reports a returned Auth deletion compensation failure without exposing details', async () => {
  const profileError = new Error('profile database detail');
  const deleteUserError = new Error('Auth deletion detail');
  const fake = fakeAdminClient({ profileError, deleteUserError });

  await assert.rejects(
    () => bootstrapAdmin({
      env: bootstrapEnvironment(),
      readConfiguration: () => ({}),
      createServices: () => ({ adminClient: fake.adminClient }),
      now: () => new Date('2026-09-08T16:00:00.000Z'),
      createLeaseOwnerToken: () => 'c2609b28-c4e3-41cb-9246-7cc2e2ecd6f2',
    }),
    (error) => error.cause === profileError
      && !error.message.includes('profile database detail')
      && !error.message.includes('Auth deletion detail'),
  );
  assert.deepEqual(fake.deletedUsers, ['admin-auth-id']);
  assert.deepEqual(fake.lockDeleteFilters.slice(-2), [
    ['scope', 'first-admin'],
    ['owner_token', 'c2609b28-c4e3-41cb-9246-7cc2e2ecd6f2'],
  ]);
});

test('bootstrap rejects a held lease before creating a second Auth identity', async () => {
  const fake = fakeAdminClient({ lockError: { code: '23505', message: 'duplicate key' } });

  await assert.rejects(
    () => bootstrapAdmin({
      env: bootstrapEnvironment(),
      readConfiguration: () => ({}),
      createServices: () => ({ adminClient: fake.adminClient }),
    }),
    /já está em andamento/,
  );
  assert.deepEqual(fake.authCalls, []);
});

test('bootstrap rejects an existing administrator before trying to acquire a lease', async () => {
  const fake = fakeAdminClient({ existingAdmins: [{ id: 'admin-existente' }] });

  await assert.rejects(
    () => bootstrapAdmin({
      env: bootstrapEnvironment(),
      readConfiguration: () => ({}),
      createServices: () => ({ adminClient: fake.adminClient }),
    }),
    /Já existe um administrador/,
  );
  assert.deepEqual(fake.lockInserts, []);
  assert.deepEqual(fake.authCalls, []);
});
