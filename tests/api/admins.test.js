import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const activeAdmin = { id: 'admin-1', role: 'admin', active: true };

test('active administrators use the dedicated public /api/admins path only', async () => {
  const calls = [];
  const publicAdministrator = {
    id: 'admin-2', name: 'Bia Admin', username: 'bia.admin', active: true,
  };
  const app = createApp({
    services: {
      auth: { verifyActor: async () => activeAdmin },
      session: {
        confirmPassword: async (input) => calls.push({ method: 'confirmPassword', input }),
      },
      administrators: {
        listAdministrators: async (actor) => {
          calls.push({ method: 'listAdministrators', actor });
          return [publicAdministrator];
        },
        createAdministrator: async (input, actor) => {
          calls.push({ method: 'createAdministrator', input, actor });
          return publicAdministrator;
        },
        archiveAdministrator: async (id, actor) => {
          calls.push({ method: 'archiveAdministrator', id, actor });
        },
      },
    },
    config: { nodeEnv: 'test' },
  });

  const list = await request(app).get('/api/admins').set('Authorization', 'Bearer token');
  const create = await request(app)
    .post('/api/admins')
    .set('Authorization', 'Bearer token')
    .send({ name: 'Bia Admin', username: 'bia.admin', password: 'senha-inicial-segura' });
  const remove = await request(app)
    .delete('/api/admins/admin-2')
    .set('Authorization', 'Bearer token')
    .send({ password: 'confirm-admin-archive' });

  assert.equal(list.status, 200);
  assert.equal(create.status, 201);
  assert.equal(remove.status, 204);
  assert.equal(remove.headers['cache-control'], 'no-store');
  assert.deepEqual(list.body, [publicAdministrator]);
  assert.deepEqual(create.body, publicAdministrator);
  assert.equal(Object.hasOwn(create.body, 'email'), false);
  assert.deepEqual(calls, [
    { method: 'listAdministrators', actor: activeAdmin },
    {
      method: 'createAdministrator',
      input: { name: 'Bia Admin', username: 'bia.admin', password: 'senha-inicial-segura' },
      actor: activeAdmin,
    },
    {
      method: 'confirmPassword',
      input: { id: 'admin-1', password: 'confirm-admin-archive' },
    },
    { method: 'archiveAdministrator', id: 'admin-2', actor: activeAdmin },
  ]);
});

test('seller and inactive administrator cannot call /api/admins', async () => {
  for (const actor of [
    { id: 'seller-1', role: 'seller', active: true },
    { id: 'admin-1', role: 'admin', active: false },
  ]) {
    let called = false;
    const app = createApp({
      services: {
        auth: { verifyActor: async () => actor },
        administrators: {
          listAdministrators: async () => { called = true; return []; },
          createAdministrator: async () => { called = true; return {}; },
        },
      },
      config: { nodeEnv: 'test' },
    });

    await request(app).get('/api/admins').set('Authorization', 'Bearer token').expect(403);
    await request(app)
      .post('/api/admins')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Bia', username: 'bia', password: 'senha-inicial-segura' })
      .expect(403);
    assert.equal(called, false);
  }
});
