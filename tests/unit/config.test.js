import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../../src/server/config.js';

const productionEnv = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

test('readConfig rejects Firebase variables', () => {
  assert.throws(
    () => readConfig({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'legacy' }),
    /Variáveis Firebase não são aceitas/,
  );
});

test('readConfig rejects a default development environment without Supabase variables', () => {
  assert.throws(
    () => readConfig({}),
    /SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test('readConfig permits a test environment without Supabase variables', () => {
  assert.deepEqual(readConfig({ NODE_ENV: 'test' }), {
    nodeEnv: 'test',
    supabaseUrl: undefined,
    supabasePublishableKey: undefined,
    supabaseServiceRoleKey: undefined,
    sessionCookieName: 'galaxy-smart-refresh',
    secureCookies: false,
  });
});

for (const missingVariable of [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]) {
  test(`readConfig rejects production configuration without ${missingVariable}`, () => {
    const env = { ...productionEnv };
    delete env[missingVariable];

    assert.throws(() => readConfig(env), new RegExp(missingVariable));
  });
}

test('readConfig returns the production RuntimeConfig with secure refresh cookies', () => {
  assert.deepEqual(readConfig(productionEnv), {
    nodeEnv: 'production',
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'publishable-key',
    supabaseServiceRoleKey: 'service-role-key',
    sessionCookieName: '__Host-galaxy-smart-refresh',
    secureCookies: true,
  });
});
