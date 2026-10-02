import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCloudSmokeDatabaseIsEmpty, readCloudSmokeConfig, survivingFixtures } from '../../scripts/cloud-smoke.js';

const validEnvironment = {
  ALLOW_CLOUD_SMOKE: '1',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

test('cloud smoke requires the explicit guard before accepting any configuration', () => {
  assert.throws(
    () => readCloudSmokeConfig({ ...validEnvironment, ALLOW_CLOUD_SMOKE: '0' }),
    /ALLOW_CLOUD_SMOKE=1/,
  );
});

test('cloud smoke accepts only a complete valid Supabase configuration', () => {
  assert.deepEqual(readCloudSmokeConfig(validEnvironment), {
    nodeEnv: 'production',
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'publishable-key',
    supabaseServiceRoleKey: 'service-role-key',
    sessionCookieName: '__Host-galaxy-smart-refresh',
    secureCookies: true,
  });
  assert.throws(
    () => readCloudSmokeConfig({ ...validEnvironment, SUPABASE_SERVICE_ROLE_KEY: '' }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test('cloud smoke refuses to create fixtures unless profiles and commissions are both empty', async () => {
  const calls = [];
  const adminClient = {
    from(table) {
      return {
        select: async (...args) => {
          calls.push({ table, args });
          return { count: table === 'profiles' ? 1 : 0, error: null };
        },
      };
    },
  };

  await assert.rejects(
    () => assertCloudSmokeDatabaseIsEmpty(adminClient),
    /vazio.*profiles/i,
  );
  assert.deepEqual(calls, [{ table: 'profiles', args: ['id', { count: 'exact', head: true }] }]);
});

test('survivingFixtures exige confirmação explícita ao verificar limpeza de auth.users', async () => {
  const responses = new Map([
    ['present', { data: { user: { id: 'present' } }, error: null }],
    ['missing-status', { data: { user: null }, error: { status: 404, message: 'User not found' } }],
    ['missing-code', { data: { user: null }, error: { code: 'user_not_found' } }],
    ['server-error', { data: { user: null }, error: { status: 500, message: 'Internal server error' } }],
    ['server-message-not-found', { data: { user: null }, error: { status: 500, message: 'User not found' } }],
    ['noncanonical-code', { data: { user: null }, error: { code: 'user-not-found' } }],
    ['malformed-error', { data: { user: null }, error: {} }],
  ]);
  const fixtures = {
    authUserIds: new Set([
      'present',
      'missing-status',
      'missing-code',
      'server-error',
      'server-message-not-found',
      'noncanonical-code',
      'malformed-error',
      'transport-error',
    ]),
    profileIds: new Set(),
    commissionIds: new Set(),
    paymentBatchIds: new Set(),
  };
  const adminClient = {
    auth: {
      admin: {
        async getUserById(id) {
          if (id === 'transport-error') throw new Error('network unavailable');
          return responses.get(id);
        },
      },
    },
  };

  assert.deepEqual(
    await survivingFixtures(adminClient, fixtures),
    [
      'auth.users',
      'não foi possível confirmar auth.users',
      'não foi possível confirmar auth.users',
      'não foi possível confirmar auth.users',
      'não foi possível confirmar auth.users',
      'não foi possível confirmar auth.users',
    ],
  );
});
