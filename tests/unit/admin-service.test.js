import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdministratorService } from '../../src/server/services/admin-service.js';

test('createAdministrator requires an active administrator actor', async () => {
  const service = createAdministratorService({ adminClient: {} });
  const input = { name: 'Ana Admin', username: 'ana.admin', password: 'senha-inicial-segura' };

  for (const actor of [
    { id: 'seller-1', role: 'seller', active: true },
    { id: 'admin-1', role: 'admin', active: false },
  ]) {
    await assert.rejects(
      () => service.createAdministrator(input, actor),
      (error) => error.status === 403 && error.code === 'ADMIN_REQUIRED',
    );
  }
});

test('createAdministrator creates an active administrator with a server-private identity', async () => {
  const authCalls = [];
  const profileInserts = [];
  const service = createAdministratorService({
    adminClient: {
      auth: {
        admin: {
          createUser: async (input) => {
            authCalls.push(input);
            return { data: { user: { id: 'admin-auth-id' } }, error: null };
          },
        },
      },
      from: (table) => {
        assert.equal(table, 'profiles');
        return {
          insert: (row) => ({
            select: () => ({
              single: async () => {
                profileInserts.push(row);
                return { data: row, error: null };
              },
            }),
          }),
        };
      },
    },
  });

  const administrator = await service.createAdministrator({
    name: ' Ana Admin ', username: ' Ana.Admin ', password: 'senha-inicial-segura',
  }, { id: 'admin-1', role: 'admin', active: true });

  assert.match(authCalls[0].email, /^admin-[a-f0-9]{32}@users\.galaxy-smart\.invalid$/);
  assert.deepEqual({ ...authCalls[0], email: '[private]' }, {
    email: '[private]', password: 'senha-inicial-segura', email_confirm: true,
  });
  assert.deepEqual({ ...profileInserts[0], email: '[private]' }, {
    id: 'admin-auth-id',
    email: '[private]',
    username: 'Ana.Admin',
    username_normalized: 'ana.admin',
    display_name: 'Ana Admin',
    role: 'admin',
    active: true,
  });
  assert.deepEqual(administrator, {
    id: 'admin-auth-id', name: 'Ana Admin', username: 'Ana.Admin', active: true,
  });
  assert.equal(Object.hasOwn(administrator, 'email'), false);
});

test('createAdministrator deletes the private Auth identity when profile insertion fails', async () => {
  const deleted = [];
  const profileFailure = new Error('profile database failure');
  const service = createAdministratorService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'admin-auth-id' } }, error: null }),
          deleteUser: async (id) => deleted.push(id),
        },
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: profileFailure }),
          }),
        }),
      }),
    },
  });

  await assert.rejects(
    () => service.createAdministrator({
      name: 'Ana Admin', username: 'ana.admin', password: 'senha-inicial-segura',
    }, { id: 'admin-1', role: 'admin', active: true }),
    /profile database failure/,
  );
  assert.deepEqual(deleted, ['admin-auth-id']);
});

test('createAdministrator translates a profile username uniqueness conflict after compensating Auth', async () => {
  const deleted = [];
  const service = createAdministratorService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'admin-auth-id' } }, error: null }),
          deleteUser: async (id) => deleted.push(id),
        },
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', details: 'Key (username_normalized)=(ana.admin) already exists.' },
            }),
          }),
        }),
      }),
    },
  });

  await assert.rejects(
    () => service.createAdministrator({
      name: 'Ana Admin', username: 'ana.admin', password: 'senha-inicial-segura',
    }, { id: 'admin-1', role: 'admin', active: true }),
    (error) => error.status === 409
      && error.code === 'USERNAME_TAKEN'
      && error.message === 'Nome de usuário já está em uso.',
  );
  assert.deepEqual(deleted, ['admin-auth-id']);
});

test('createAdministrator reports a failed Auth compensation without exposing profile details', async () => {
  const profileFailure = new Error('private profile database detail');
  const deletionFailure = new Error('private Auth deletion detail');
  const service = createAdministratorService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'admin-auth-id' } }, error: null }),
          deleteUser: async () => ({ error: deletionFailure }),
        },
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: profileFailure }),
          }),
        }),
      }),
    },
  });

  await assert.rejects(
    () => service.createAdministrator({
      name: 'Ana Admin', username: 'ana.admin', password: 'senha-inicial-segura',
    }, { id: 'admin-1', role: 'admin', active: true }),
    (error) => error.status === 500
      && error.code === 'AUTH_COMPENSATION_FAILED'
      && error.cause === profileFailure
      && !error.message.includes('private profile database detail')
      && !error.message.includes('private Auth deletion detail'),
  );
});

test('createAdministrator reports a thrown Auth deletion compensation failure without exposing details', async () => {
  const profileFailure = new Error('private profile database detail');
  const deletionFailure = new Error('private Auth deletion provider detail');
  const service = createAdministratorService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'admin-auth-id' } }, error: null }),
          deleteUser: async () => { throw deletionFailure; },
        },
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: profileFailure }),
          }),
        }),
      }),
    },
  });

  await assert.rejects(
    () => service.createAdministrator({
      name: 'Ana Admin', username: 'ana.admin', password: 'senha-inicial-segura',
    }, { id: 'admin-1', role: 'admin', active: true }),
    (error) => error.status === 500
      && error.code === 'AUTH_COMPENSATION_FAILED'
      && error.cause === profileFailure
      && !error.message.includes('private profile database detail')
      && !error.message.includes('private Auth deletion provider detail'),
  );
});

test('createAdministrator rejects browser-controlled role and contact fields', async () => {
  const authCalls = [];
  const service = createAdministratorService({
    adminClient: {
      auth: {
        admin: {
          createUser: async (input) => {
            authCalls.push(input);
            return { data: { user: { id: 'unexpected' } }, error: null };
          },
        },
      },
    },
  });
  const actor = { id: 'admin-1', role: 'admin', active: true };
  const base = { name: 'Ana Admin', username: 'ana.admin', password: 'senha-inicial-segura' };

  for (const extra of [
    { role: 'seller' },
    { email: 'ana@exemplo.com' },
    { phone: '11999999999' },
  ]) {
    await assert.rejects(
      () => service.createAdministrator({ ...base, ...extra }, actor),
      (error) => error.status === 400 && error.code === 'INVALID_ADMINISTRATOR',
    );
  }
  assert.deepEqual(authCalls, []);
});

test('listAdministrators requires an active administrator and returns public data only', async () => {
  const calls = [];
  const service = createAdministratorService({
    adminClient: {
      from: (table) => {
        assert.equal(table, 'profiles');
        return {
          select: (columns) => {
            calls.push({ method: 'select', columns });
            const query = {
              eq: (field, value) => {
                calls.push({ method: 'eq', field, value });
                return query;
              },
              is: (field, value) => {
                calls.push({ method: 'is', field, value });
                return query;
              },
              order: (field, options) => {
                calls.push({ method: 'order', field, options });
                return Promise.resolve({
                  data: [{
                    id: 'admin-2',
                    email: 'private@users.galaxy-smart.invalid',
                    username: 'bia.admin',
                    display_name: 'Bia Admin',
                    active: true,
                  }],
                  error: null,
                });
              },
            };
            return query;
          },
        };
      },
    },
  });

  await assert.rejects(
    () => service.listAdministrators({ id: 'seller-1', role: 'seller', active: true }),
    (error) => error.status === 403 && error.code === 'ADMIN_REQUIRED',
  );
  const administrators = await service.listAdministrators({ id: 'admin-1', role: 'admin', active: true });

  assert.deepEqual(calls, [
    { method: 'select', columns: 'id, username, display_name, active' },
    { method: 'eq', field: 'role', value: 'admin' },
    { method: 'is', field: 'archived_at', value: null },
    { method: 'order', field: 'display_name', options: { ascending: true } },
  ]);
  assert.deepEqual(administrators, [{
    id: 'admin-2', name: 'Bia Admin', username: 'bia.admin', active: true,
  }]);
  assert.equal(Object.hasOwn(administrators[0], 'email'), false);
});

test('archiveAdministrator uses the transactionally audited archival RPC before revoking access', async () => {
  const calls = [];
  const timestamp = new Date('2026-09-09T16:00:00.000Z');
  const service = createAdministratorService({
    adminClient: {
      async rpc(name, args) {
        calls.push(['archiveProfile', name, args]);
        return {
          data: [{ target_id: 'admin-2', target_role: 'admin', target_display_name: 'Bia Admin' }],
          error: null,
        };
      },
      from(table) {
        assert.equal(table, 'app_session_registry');
        return {
          update(input) {
            calls.push(['revokeSessions', input]);
            const query = { eq: () => query, is: async () => ({ error: null }) };
            return query;
          },
        };
      },
    },
    now: () => timestamp,
  });

  await service.archiveAdministrator('admin-2', { id: 'admin-1', role: 'admin', active: true });

  assert.deepEqual(calls, [
    ['archiveProfile', 'archive_profile', { p_target_id: 'admin-2', p_actor_id: 'admin-1', p_expected_role: 'admin' }],
    ['revokeSessions', { revoked_at: timestamp.toISOString() }],
  ]);
});

test('archiveAdministrator treats an expected-role refusal as not found without revoking a cross-role account', async () => {
  const calls = [];
  const service = createAdministratorService({
    adminClient: {
      auth: {
        admin: {
          updateUserById: async () => {
            calls.push(['banAuth']);
            return { data: null, error: null };
          },
        },
      },
      async rpc(name, args) {
        calls.push(['archiveProfile', name, args]);
        return { data: null, error: { code: 'P0002' } };
      },
      from(table) {
        calls.push(['revokeSessions', table]);
        return {
          update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }),
        };
      },
    },
  });

  await assert.rejects(
    () => service.archiveAdministrator('seller-2', { id: 'admin-1', role: 'admin', active: true }),
    (error) => error.status === 404 && error.code === 'ADMINISTRATOR_NOT_FOUND',
  );

  assert.deepEqual(calls, [
    ['archiveProfile', 'archive_profile', {
      p_target_id: 'seller-2', p_actor_id: 'admin-1', p_expected_role: 'admin',
    }],
  ]);
});

test('archiveAdministrator preserves transactional self and last-admin safeguards as public domain errors', async () => {
  for (const [databaseCode, expected] of [
    ['22023', { status: 400, code: 'SELF_ARCHIVE_FORBIDDEN' }],
    ['23514', { status: 409, code: 'LAST_ADMINISTRATOR' }],
  ]) {
    const service = createAdministratorService({
      adminClient: {
        rpc: async () => ({ data: null, error: { code: databaseCode } }),
      },
    });

    await assert.rejects(
      () => service.archiveAdministrator('admin-2', { id: 'admin-1', role: 'admin', active: true }),
      (error) => error.status === expected.status && error.code === expected.code,
    );
  }
});
