import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerServices } from '../../src/server/supabase-admin.js';

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

test('createServerServices returns distinct publishable and service-role clients without server persistence', () => {
  const calls = [];
  const authClient = { client: 'auth' };
  const adminClient = { client: 'admin' };
  const createClient = (...args) => {
    calls.push(args);
    return calls.length === 1 ? authClient : adminClient;
  };

  const services = createServerServices({
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'publishable-key',
    supabaseServiceRoleKey: 'service-role-key',
  }, { createClient });

  assert.deepEqual(services, { authClient, adminClient });
  assert.notEqual(services.authClient, services.adminClient);
  assert.deepEqual(calls, [
    ['https://project.supabase.co', 'publishable-key', { auth: serverAuthOptions }],
    ['https://project.supabase.co', 'service-role-key', { auth: serverAuthOptions }],
  ]);
});
