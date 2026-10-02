import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClient } from '../../src/client/session-client.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

function installStorageSpy(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const calls = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (...args) => calls.push(['getItem', ...args]),
      removeItem: (...args) => calls.push(['removeItem', ...args]),
      setItem: (...args) => calls.push(['setItem', ...args]),
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return calls;
}

test('session client keeps refresh token out of browser storage', async (t) => {
  const storageCalls = installStorageSpy(t);
  const requests = [];
  const actor = { id: 'seller-1', role: 'seller', name: 'Vendas SP' };
  const client = createSessionClient({
    fetchImpl: async (path, options) => {
      requests.push({ path, options });
      return jsonResponse({ accessToken: 'access-token', expiresAt: 123, actor });
    },
  });

  const authenticatedActor = await client.login({ identifier: 'seller', password: 'SenhaSegura123!' });

  assert.deepEqual(authenticatedActor, actor);
  assert.equal(client.getAccessToken(), 'access-token');
  assert.deepEqual(storageCalls, []);
  assert.deepEqual(requests, [{
    path: '/api/auth/login',
    options: {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'seller', password: 'SenhaSegura123!' }),
    },
  }]);

  client.clear();
  assert.equal(client.getAccessToken(), undefined);
});

test('session client restores the ephemeral access token with its same-origin cookie', async () => {
  const requests = [];
  const actor = { id: 'admin-1', role: 'admin', name: 'Admin' };
  const client = createSessionClient({
    fetchImpl: async (path, options) => {
      requests.push({ path, options });
      return jsonResponse({ accessToken: 'restored-access-token', expiresAt: 456, actor });
    },
  });

  assert.deepEqual(await client.restore(), actor);
  assert.equal(client.getAccessToken(), 'restored-access-token');
  assert.deepEqual(requests, [{
    path: '/api/auth/refresh',
    options: { method: 'POST', credentials: 'same-origin' },
  }]);
});

test('session client clears its local token even when logout cannot reach the server', async () => {
  let requestCount = 0;
  const client = createSessionClient({
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) return jsonResponse({ accessToken: 'access-token', actor: {} });
      throw new Error('network unavailable');
    },
  });

  await client.login({ identifier: 'seller', password: 'SenhaSegura123!' });
  await assert.rejects(() => client.logout());

  assert.equal(client.getAccessToken(), undefined);
});
