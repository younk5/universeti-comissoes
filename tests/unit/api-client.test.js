import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../../src/client/api-client.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test('api client sends the ephemeral access token and same-origin credentials', async () => {
  const calls = [];
  const api = createApiClient({
    getAccessToken: () => 'access-token',
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return jsonResponse({ id: 'seller-1' });
    },
  });

  assert.deepEqual(await api.request('/api/me'), { id: 'seller-1' });
  assert.deepEqual(calls, [{
    path: '/api/me',
    options: {
      credentials: 'same-origin',
      headers: { Authorization: 'Bearer access-token' },
    },
  }]);
});

test('api client omits Bearer when no ephemeral access token exists', async () => {
  const calls = [];
  const api = createApiClient({
    getAccessToken: () => undefined,
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return jsonResponse({ ready: true });
    },
  });

  assert.deepEqual(await api.request('/api/public-status'), { ready: true });
  assert.deepEqual(calls, [{
    path: '/api/public-status',
    options: { credentials: 'same-origin', headers: {} },
  }]);
});

test('api client converts JSON error messages into Error', async () => {
  const api = createApiClient({
    getAccessToken: () => 'access-token',
    fetchImpl: async () => jsonResponse({ message: 'Dados inválidos.' }, { ok: false, status: 400 }),
  });

  await assert.rejects(
    () => api.request('/api/commissions'),
    (error) => error instanceof Error && error.message === 'Dados inválidos.',
  );
});

test('two expired API calls share one refresh and retry once each', async () => {
  let accessToken = 'expired-token';
  let refreshCalls = 0;
  let beginRefresh;
  let releaseRefresh;
  const refreshStarted = new Promise((resolve) => { beginRefresh = resolve; });
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const calls = [];
  let unauthorizedCalls = 0;
  const api = createApiClient({
    getAccessToken: () => accessToken,
    refreshSession: async () => {
      refreshCalls += 1;
      beginRefresh();
      await refreshGate;
      accessToken = 'fresh-token';
      return { id: 'seller-1' };
    },
    onUnauthorized: () => { unauthorizedCalls += 1; },
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      if (options.headers.Authorization === 'Bearer expired-token') {
        return jsonResponse({ message: 'Sessão expirada.' }, { ok: false, status: 401 });
      }
      return jsonResponse({ path });
    },
  });

  const results = Promise.all([api.get('/a'), api.get('/b')]);
  await refreshStarted;
  releaseRefresh();

  assert.deepEqual(await results, [{ path: '/a' }, { path: '/b' }]);
  assert.equal(refreshCalls, 1);
  assert.equal(unauthorizedCalls, 0);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ options }) => options.credentials === 'same-origin'));
  assert.equal(calls.filter(({ options }) => options.headers.Authorization === 'Bearer expired-token').length, 2);
  assert.equal(calls.filter(({ options }) => options.headers.Authorization === 'Bearer fresh-token').length, 2);
});

test('api client retries a delayed stale 401 with the refreshed token', async () => {
  let accessToken = 'expired-token';
  let refreshCalls = 0;
  let beginRefresh;
  let bothStaleAttempts;
  const refreshStarted = new Promise((resolve) => { beginRefresh = resolve; });
  const staleResponses = new Map();
  const staleAttemptsReady = new Promise((resolve) => { bothStaleAttempts = resolve; });
  const attempts = [];
  let unauthorizedCalls = 0;
  const api = createApiClient({
    getAccessToken: () => accessToken,
    refreshSession: async () => {
      refreshCalls += 1;
      beginRefresh();
      accessToken = 'fresh-token';
      return { id: 'seller-1' };
    },
    onUnauthorized: () => { unauthorizedCalls += 1; },
    fetchImpl: async (path, options) => {
      const authorization = options.headers.Authorization;
      attempts.push({ path, authorization });
      if (authorization === 'Bearer expired-token') {
        return new Promise((resolve) => {
          staleResponses.set(path, resolve);
          if (staleResponses.size === 2) bothStaleAttempts();
        });
      }
      return jsonResponse({ path });
    },
  });

  const firstRequest = api.get('/first');
  const secondRequest = api.get('/second');
  await staleAttemptsReady;

  staleResponses.get('/first')(jsonResponse({ message: 'Sessão expirada.' }, { ok: false, status: 401 }));
  await refreshStarted;
  assert.deepEqual(await firstRequest, { path: '/first' });

  staleResponses.get('/second')(jsonResponse({ message: 'Sessão expirada.' }, { ok: false, status: 401 }));
  assert.deepEqual(await secondRequest, { path: '/second' });

  assert.equal(refreshCalls, 1);
  assert.equal(unauthorizedCalls, 0);
  assert.equal(attempts.length, 4);
  assert.equal(attempts.filter(({ authorization }) => authorization === 'Bearer expired-token').length, 2);
  assert.equal(attempts.filter(({ authorization }) => authorization === 'Bearer fresh-token').length, 2);
});

test('api client protects CSV downloads with one refresh and retry', async () => {
  let accessToken = 'expired-token';
  let refreshCalls = 0;
  const expectedBlob = new Blob(['Vendedor,Comissão\r\nAna,10\r\n'], { type: 'text/csv;charset=utf-8' });
  const api = createApiClient({
    getAccessToken: () => accessToken,
    refreshSession: async () => {
      refreshCalls += 1;
      accessToken = 'fresh-token';
    },
    fetchImpl: async (_path, options) => {
      if (options.headers.Authorization === 'Bearer expired-token') {
        return jsonResponse({ message: 'Sessão expirada.' }, { ok: false, status: 401 });
      }
      return { ok: true, status: 200, blob: async () => expectedBlob };
    },
  });

  assert.equal(await api.download('/api/commissions/export.csv'), expectedBlob);
  assert.equal(refreshCalls, 1);
});

test('api client returns to login after an unsuccessful refresh', async () => {
  let unauthorizedCalls = 0;
  const api = createApiClient({
    getAccessToken: () => 'expired-token',
    refreshSession: async () => false,
    onUnauthorized: () => { unauthorizedCalls += 1; },
    fetchImpl: async () => jsonResponse({ message: 'Sessão necessária.' }, { ok: false, status: 401 }),
  });

  await assert.rejects(() => api.request('/api/me'), /Sessão necessária/);
  assert.equal(unauthorizedCalls, 1);
});
