import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserService } from '../../src/server/services/user-service.js';

const adminActor = { id: 'admin-id', role: 'admin', active: true };
const validSeller = {
  name: ' Ana ',
  email: ' ANA@EXEMPLO.COM ',
  username: ' Ana.Vendas ',
  password: 'senha-inicial-segura',
  phone: '11999999999',
};

function fakeAdmin() {
  const authCalls = [];
  const profileInserts = [];

  return {
    authCalls,
    profileInserts,
    adminClient: {
      auth: {
        admin: {
          createUser: async (input) => {
            authCalls.push(input);
            return { data: { user: { id: 'seller-auth-id' } }, error: null };
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
  };
}

test('createSeller persists normalized optional contact without a seller commission rule', async () => {
  const fake = fakeAdmin();
  const timestamp = new Date('2026-09-08T12:00:00.000Z');
  const service = createUserService({ adminClient: fake.adminClient, now: () => timestamp });

  const seller = await service.createSeller(validSeller, adminActor);

  assert.equal(fake.authCalls.length, 1);
  assert.match(fake.authCalls[0].email, /^seller-[a-f0-9]{32}@users\.galaxy-smart\.invalid$/);
  assert.deepEqual({ ...fake.authCalls[0], email: '[private]' }, {
    email: '[private]',
    password: 'senha-inicial-segura',
    email_confirm: true,
    user_metadata: {
      galaxy_smart_phone: '11999999999',
    },
  });
  assert.equal(fake.profileInserts.length, 1);
  assert.equal(fake.profileInserts[0].email, fake.authCalls[0].email);
  assert.deepEqual({ ...fake.profileInserts[0], email: '[private]' }, {
    id: 'seller-auth-id',
    email: '[private]',
    username: 'Ana.Vendas',
    username_normalized: 'ana.vendas',
    display_name: 'Ana',
    phone: '11999999999',
    role: 'seller',
    active: true,
  });
  assert.deepEqual(seller, {
    id: 'seller-auth-id',
    name: 'Ana',
    username: 'Ana.Vendas',
    phone: '11999999999',
    active: true,
  });
});

test('createSeller creates a private Auth identity when email and phone are omitted', async () => {
  const fake = fakeAdmin();
  const service = createUserService({ adminClient: fake.adminClient });

  const seller = await service.createSeller({
    name: 'Bia',
    email: 'externo@exemplo.com',
    username: 'bia',
    password: 'senha-inicial-segura',
  }, adminActor);

  assert.match(fake.authCalls[0].email, /^seller-[a-f0-9]{32}@users\.galaxy-smart\.invalid$/);
  assert.equal(fake.profileInserts[0].email, fake.authCalls[0].email);
  assert.equal(fake.profileInserts[0].phone, null);
  assert.equal(Object.hasOwn(seller, 'email'), false);
  assert.equal(seller.phone, '');
});

test('createSeller and updateSeller reject the removed seller default rate before persistence', async () => {
  const fake = fakeAdmin();
  const service = createUserService({ adminClient: fake.adminClient });

  for (const action of [
    () => service.createSeller({ ...validSeller, defaultCommissionRate: 10 }, adminActor),
    () => service.updateSeller('seller-auth-id', { defaultCommissionRate: 10 }, adminActor),
  ]) {
    await assert.rejects(
      action,
      (error) => error.status === 400 && error.code === 'INVALID_SELLER' && error.message.includes('Produtos'),
    );
  }
  assert.deepEqual(fake.authCalls, []);
  assert.deepEqual(fake.profileInserts, []);
});

test('createSeller deletes Auth identity when profile insertion fails', async () => {
  const deleted = [];
  const insertProfileError = new Error('db down');
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'seller-auth-id' } }, error: null }),
          deleteUser: async (id) => deleted.push(id),
        },
      },
      from: (table) => {
        assert.equal(table, 'profiles');
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: insertProfileError }),
            }),
          }),
        };
      },
    },
  });

  await assert.rejects(() => service.createSeller(validSeller, adminActor), /db down/);
  assert.deepEqual(deleted, ['seller-auth-id']);
});

test('createSeller reports a returned Auth deletion compensation failure without exposing details', async () => {
  const profileError = new Error('profile database detail');
  const deletionError = new Error('Auth deletion detail');
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'seller-auth-id' } }, error: null }),
          deleteUser: async () => ({ error: deletionError }),
        },
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: profileError }),
          }),
        }),
      }),
    },
  });

  await assert.rejects(
    () => service.createSeller(validSeller, adminActor),
    (error) => error.status === 500
      && error.code === 'AUTH_COMPENSATION_FAILED'
      && error.cause === profileError
      && !error.message.includes('profile database detail')
      && !error.message.includes('Auth deletion detail'),
  );
});

test('resetSellerPassword returns a temporary password once without storing it in the profile', async () => {
  const profileUpdates = [];
  const authUpdates = [];
  const timestamp = new Date('2026-09-08T13:00:00.000Z');
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          updateUserById: async (id, input) => {
            authUpdates.push({ id, input });
            return { data: { user: { id } }, error: null };
          },
        },
      },
      from: (table) => {
        assert.equal(table, 'profiles');
        return {
          update: (row) => {
            profileUpdates.push(row);
            const query = {
              eq: () => query,
              select: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'seller-id', email: 'ana@exemplo.com', username: 'ana',
                    display_name: 'Ana', active: true,
                  },
                  error: null,
                }),
              }),
            };
            return query;
          },
        };
      },
    },
    now: () => timestamp,
    createTemporaryPassword: () => 'senha-temporaria-segura',
  });

  const result = await service.resetSellerPassword('seller-id', adminActor);

  assert.deepEqual(result, { temporaryPassword: 'senha-temporaria-segura' });
  assert.deepEqual(authUpdates, [{
    id: 'seller-id', input: { password: 'senha-temporaria-segura' },
  }]);
  assert.deepEqual(profileUpdates, [{
    session_not_before: timestamp.toISOString(),
    updated_at: timestamp.toISOString(),
  }]);
  assert.equal(profileUpdates.some((row) => 'temporaryPassword' in row), false);
});

test('setSellerActive deactivates the profile, revokes sessions, and bans the Auth identity', async () => {
  const profileUpdates = [];
  const registryUpdates = [];
  const authUpdates = [];
  const timestamp = new Date('2026-09-08T14:00:00.000Z');
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          updateUserById: async (id, input) => {
            authUpdates.push({ id, input });
            return { data: { user: { id } }, error: null };
          },
        },
      },
      from: (table) => {
        if (table === 'app_session_registry') {
          return {
            update: (row) => {
              registryUpdates.push(row);
              const query = {
                eq: () => query,
                is: async () => ({ error: null }),
              };
              return query;
            },
          };
        }
        assert.equal(table, 'profiles');
        return {
          update: (row) => {
            profileUpdates.push(row);
            const query = {
              eq: () => query,
              select: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'seller-id', email: 'ana@exemplo.com', username: 'ana',
                    display_name: 'Ana', active: false,
                  },
                  error: null,
                }),
              }),
            };
            return query;
          },
        };
      },
    },
    now: () => timestamp,
  });

  const seller = await service.setSellerActive('seller-id', false, adminActor);

  assert.deepEqual(profileUpdates, [{
    active: false,
    session_not_before: timestamp.toISOString(),
    updated_at: timestamp.toISOString(),
  }]);
  assert.deepEqual(registryUpdates, [{ revoked_at: timestamp.toISOString() }]);
  assert.deepEqual(authUpdates, [{ id: 'seller-id', input: { ban_duration: '876000h' } }]);
  assert.deepEqual(seller, {
    id: 'seller-id', name: 'Ana', username: 'ana',
    phone: '', active: false,
  });
});

test('setSellerActive retries the base seller profile contract when migration 006 columns are absent', async () => {
  const profileUpdates = [];
  const registryUpdates = [];
  const authUpdates = [];
  const selectedColumns = [];
  const timestamp = new Date('2026-09-08T14:30:00.000Z');
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          updateUserById: async (id, input) => {
            authUpdates.push({ id, input });
            return { data: { user: { id } }, error: null };
          },
        },
      },
      from: (table) => {
        if (table === 'app_session_registry') {
          return {
            update: (row) => {
              registryUpdates.push(row);
              const query = {
                eq: () => query,
                is: async () => ({ error: null }),
              };
              return query;
            },
          };
        }
        assert.equal(table, 'profiles');
        return {
          update: (row) => {
            profileUpdates.push(row);
            const query = {
              eq: () => query,
              select: (columns) => ({
                maybeSingle: async () => {
                  selectedColumns.push(columns);
                  if (columns.includes('phone')) {
                    return { data: null, error: { code: '42703', message: 'column phone does not exist' } };
                  }
                  return {
                    data: {
                      id: 'seller-id', email: 'internal@users.galaxy-smart.invalid', username: 'carlos',
                      display_name: 'Carlos', active: false,
                    },
                    error: null,
                  };
                },
              }),
            };
            return query;
          },
        };
      },
    },
    now: () => timestamp,
  });

  const seller = await service.setSellerActive('seller-id', false, adminActor);

  assert.deepEqual(selectedColumns, [
    'id, email, username, display_name, phone, active',
    'id, email, username, display_name, active',
  ]);
  assert.deepEqual(profileUpdates, [
    { active: false, session_not_before: timestamp.toISOString(), updated_at: timestamp.toISOString() },
    { active: false, session_not_before: timestamp.toISOString(), updated_at: timestamp.toISOString() },
  ]);
  assert.deepEqual(registryUpdates, [{ revoked_at: timestamp.toISOString() }]);
  assert.deepEqual(authUpdates, [{ id: 'seller-id', input: { ban_duration: '876000h' } }]);
  assert.deepEqual(seller, {
    id: 'seller-id', name: 'Carlos', username: 'carlos',
    phone: '', active: false,
  });
});

test('updateSeller omits unavailable optional phone when the contact column is absent', async () => {
  const updates = [];
  const timestamp = new Date('2026-09-08T14:45:00.000Z');
  const service = createUserService({
    adminClient: {
      from: (table) => {
        assert.equal(table, 'profiles');
        return {
          update: (row) => {
            const query = {
              eq: () => query,
              select: (columns) => ({
                maybeSingle: async () => {
                  updates.push({ row, columns });
                  if (Object.hasOwn(row, 'phone')) {
                    return { data: null, error: { code: '42703', message: 'column phone does not exist' } };
                  }
                  return {
                    data: {
                      id: 'seller-id', email: 'internal@users.galaxy-smart.invalid', username: 'carlos',
                      display_name: 'Carlos', active: true,
                    },
                    error: null,
                  };
                },
              }),
            };
            return query;
          },
        };
      },
    },
    now: () => timestamp,
  });

  const seller = await service.updateSeller('seller-id', {
    name: 'Carlos', username: 'carlos', phone: '',
  }, adminActor);

  assert.deepEqual(updates, [
    {
      row: {
        display_name: 'Carlos', username: 'carlos', username_normalized: 'carlos',
        phone: null, updated_at: timestamp.toISOString(),
      },
      columns: 'id, email, username, display_name, phone, active',
    },
    {
      row: {
        display_name: 'Carlos', username: 'carlos', username_normalized: 'carlos',
        updated_at: timestamp.toISOString(),
      },
      columns: 'id, email, username, display_name, active',
    },
  ]);
  assert.deepEqual(seller, {
    id: 'seller-id', name: 'Carlos', username: 'carlos',
    phone: '', active: true,
  });
});

test('listSellers maps persisted contact without a seller commission-rate field', async () => {
  const calls = [];
  const service = createUserService({
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
                  data: [
                    {
                      id: 'seller-1', email: 'ana@exemplo.com', username: 'ana', display_name: 'Ana',
                      phone: '11999999999', active: true,
                    },
                    {
                      id: 'seller-2', email: 'bia@exemplo.com', username: 'bia', display_name: 'Bia',
                      phone: null, active: false,
                    },
                  ],
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

  const sellers = await service.listSellers(adminActor);

  assert.deepEqual(calls, [
    {
      method: 'select',
      columns: 'id, email, username, display_name, phone, active',
    },
    { method: 'eq', field: 'role', value: 'seller' },
    { method: 'is', field: 'archived_at', value: null },
    { method: 'order', field: 'display_name', options: { ascending: true } },
  ]);
  assert.deepEqual(sellers, [
    {
      id: 'seller-1', name: 'Ana', username: 'ana', phone: '11999999999',
      active: true,
    },
    {
      id: 'seller-2', name: 'Bia', username: 'bia', phone: '',
      active: false,
    },
  ]);
});

test('updateSeller persists normalized contact without rewriting Auth identity', async () => {
  const authUpdates = [];
  const profileUpdates = [];
  const timestamp = new Date('2026-09-08T15:00:00.000Z');
  const current = {
    id: 'seller-id', email: 'ana@exemplo.com', username: 'ana', display_name: 'Ana',
    phone: '11999999999', active: true,
  };
  const updated = {
    id: 'seller-id', email: 'ana.vendas@exemplo.com', username: 'ANA.VENDAS',
    display_name: 'Ana Vendas', phone: '5511999999999', active: true,
  };
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          updateUserById: async (id, input) => {
            authUpdates.push({ id, input });
            return { data: { user: { id } }, error: null };
          },
        },
      },
      from: (table) => {
        assert.equal(table, 'profiles');
        return {
          select: () => {
            const query = {
              eq: () => query,
              maybeSingle: async () => ({ data: current, error: null }),
            };
            return query;
          },
          update: (row) => {
            profileUpdates.push(row);
            const query = {
              eq: () => query,
              select: () => ({ maybeSingle: async () => ({ data: updated, error: null }) }),
            };
            return query;
          },
        };
      },
    },
    now: () => timestamp,
  });

  const seller = await service.updateSeller('seller-id', {
    name: ' Ana Vendas ',
    email: ' ANA.VENDAS@EXEMPLO.COM ',
    username: ' ANA.VENDAS ',
    phone: '+55 (11) 99999-9999',
  }, adminActor);

  assert.deepEqual(authUpdates, []);
  assert.deepEqual(profileUpdates, [{
    display_name: 'Ana Vendas',
    username: 'ANA.VENDAS',
    username_normalized: 'ana.vendas',
    phone: '5511999999999',
    updated_at: timestamp.toISOString(),
  }]);
  assert.deepEqual(seller, {
    id: 'seller-id', name: 'Ana Vendas',
    username: 'ANA.VENDAS', phone: '5511999999999', active: true,
  });
});

test('createSeller translates a profile username uniqueness conflict into a domain error', async () => {
  const deleted = [];
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'seller-auth-id' } }, error: null }),
          deleteUser: async (id) => deleted.push(id),
        },
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', details: 'Key (username_normalized)=(ana.vendas) already exists.' },
            }),
          }),
        }),
      }),
    },
  });

  await assert.rejects(
    () => service.createSeller(validSeller, adminActor),
    (error) => error.status === 409 && error.code === 'USERNAME_TAKEN' && error.message === 'Nome de usuário já está em uso.',
  );
  assert.deepEqual(deleted, ['seller-auth-id']);
});

test('createSeller compensates the Auth identity when profile insertion throws', async () => {
  const deleted = [];
  const insertFailure = new Error('connection interrupted');
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'seller-auth-id' } }, error: null }),
          deleteUser: async (id) => deleted.push(id),
        },
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => {
              throw insertFailure;
            },
          }),
        }),
      }),
    },
  });

  await assert.rejects(() => service.createSeller(validSeller, adminActor), /connection interrupted/);
  assert.deepEqual(deleted, ['seller-auth-id']);
});

test('listSellers retries the base profile contract when migration 006 columns are absent', async () => {
  const selections = [];
  let attempt = 0;
  const service = createUserService({
    adminClient: {
      from: () => ({
        select: (columns) => {
          selections.push(columns);
          const query = {
            eq: () => query,
            is: () => query,
            order: async () => {
              attempt += 1;
              if (attempt === 1) {
                return { data: null, error: { code: '42703', message: 'column phone does not exist' } };
              }
              return {
                data: [{ id: 'seller-1', email: 'ana@exemplo.com', username: 'ana', display_name: 'Ana', active: true }],
                error: null,
              };
            },
          };
          return query;
        },
      }),
    },
  });

  const sellers = await service.listSellers(adminActor);

  assert.deepEqual(selections, [
    'id, email, username, display_name, phone, active',
    'id, email, username, display_name, active',
  ]);
  assert.deepEqual(sellers, [{
    id: 'seller-1', name: 'Ana', username: 'ana',
    phone: '', active: true,
  }]);
});

test('createSeller persists the base seller contract when optional metadata columns are absent', async () => {
  const inserts = [];
  const deleted = [];
  const service = createUserService({
    adminClient: {
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'seller-auth-id' } }, error: null }),
          deleteUser: async (id) => deleted.push(id),
        },
      },
      from: () => ({
        insert: (row) => ({
          select: (columns) => ({
            single: async () => {
              inserts.push({ row, columns });
              if (columns.includes('phone')) {
                return { data: null, error: { code: '42703', message: 'column phone does not exist' } };
              }
              return { data: row, error: null };
            },
          }),
        }),
      }),
    },
  });

  const seller = await service.createSeller(validSeller, adminActor);

  assert.equal(inserts.length, 2);
  assert.equal(inserts[1].columns, 'id, email, username, display_name, active');
  assert.match(inserts[1].row.email, /^seller-[a-f0-9]{32}@users\.galaxy-smart\.invalid$/);
  assert.deepEqual({ ...inserts[1].row, email: '[private]' }, {
    id: 'seller-auth-id', email: '[private]', username: 'Ana.Vendas',
    username_normalized: 'ana.vendas', display_name: 'Ana', role: 'seller', active: true,
  });
  assert.deepEqual(deleted, []);
  assert.deepEqual(seller, {
    id: 'seller-auth-id', name: 'Ana', username: 'Ana.Vendas',
    phone: '11999999999', active: true,
  });
});

test('listSellers includes archived sellers only for the backup contract', async () => {
  const filters = [];
  const service = createUserService({
    adminClient: {
      from: () => ({
        select: () => {
          const query = {
            eq: () => query,
            is: (field, value) => {
              filters.push([field, value]);
              return query;
            },
            order: async () => ({ data: [], error: null }),
          };
          return query;
        },
      }),
    },
  });

  await service.listSellers(adminActor, { includeArchived: true });

  assert.deepEqual(filters, []);
});

test('deleteSeller uses the atomic deletion RPC and removes the Auth identity', async () => {
  const calls = [];
  const service = createUserService({
    adminClient: {
      async rpc(name, args) {
        calls.push(['deleteSeller', name, args]);
        return { data: [{ deleted_seller_id: 'seller-id' }], error: null };
      },
      auth: {
        admin: {
          deleteUser: async (id) => {
            calls.push(['deleteUser', id]);
            return { data: null, error: null };
          },
        },
      },
    },
  });

  await service.deleteSeller('seller-id', adminActor);

  assert.deepEqual(calls, [
    ['deleteSeller', 'delete_seller', { p_target_id: 'seller-id', p_actor_id: 'admin-id' }],
    ['deleteUser', 'seller-id'],
  ]);
});

test('deleteSeller treats a missing target as not found without removing the Auth identity', async () => {
  const calls = [];
  const service = createUserService({
    adminClient: {
      async rpc(name, args) {
        calls.push(['deleteSeller', name, args]);
        return { data: null, error: { code: 'P0002' } };
      },
      auth: {
        admin: {
          deleteUser: async () => {
            calls.push(['deleteUser']);
            return { data: null, error: null };
          },
        },
      },
    },
  });

  await assert.rejects(
    () => service.deleteSeller('administrator-id', adminActor),
    (error) => error.status === 404 && error.code === 'SELLER_NOT_FOUND',
  );

  assert.deepEqual(calls, [
    ['deleteSeller', 'delete_seller', { p_target_id: 'administrator-id', p_actor_id: 'admin-id' }],
  ]);
});

test('deleteSeller maps a refused cross-role target to a public error instead of a 500', async () => {
  const service = createUserService({
    adminClient: {
      async rpc() {
        return { data: null, error: { code: '22023' } };
      },
      auth: { admin: { deleteUser: async () => ({ data: null, error: null }) } },
    },
  });

  await assert.rejects(
    () => service.deleteSeller('administrator-id', adminActor),
    (error) => error.status === 400 && error.code === 'SELLER_DELETE_FORBIDDEN',
  );
});
