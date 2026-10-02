import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const admin = { id: 'admin-1', role: 'admin', active: true };

test('admin receives a generated seller password once from the authenticated reset route', async () => {
  const calls = [];
  const app = createApp({
    services: {
      auth: { verifyActor: async () => admin },
      users: {
        resetSellerPassword: async (id, actor) => {
          calls.push({ id, actor });
          return { temporaryPassword: 'senha-temporaria-segura' };
        },
      },
    },
    config: { nodeEnv: 'test' },
  });

  const response = await request(app)
    .post('/api/users/seller-1/reset-password')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { temporaryPassword: 'senha-temporaria-segura' });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [{ id: 'seller-1', actor: admin }]);
});

test('admin seller routes pass the authenticated actor and delete sellers with password confirmation', async () => {
  const calls = [];
  const seller = {
    id: 'seller-1', name: 'Ana', email: 'ana@exemplo.com', username: 'ana', active: true,
  };
  const app = createApp({
    services: {
      auth: { verifyActor: async () => admin },
      session: {
        confirmPassword: async (input) => calls.push({ method: 'confirmPassword', input }),
      },
      users: {
        listSellers: async (actor) => {
          calls.push({ method: 'listSellers', actor });
          return [seller];
        },
        createSeller: async (input, actor) => {
          calls.push({ method: 'createSeller', input, actor });
          return seller;
        },
        updateSeller: async (id, input, actor) => {
          calls.push({ method: 'updateSeller', id, input, actor });
          return seller;
        },
        setSellerActive: async (id, active, actor) => {
          calls.push({ method: 'setSellerActive', id, active, actor });
          return { ...seller, active };
        },
        deleteSeller: async (id, actor) => {
          calls.push({ method: 'deleteSeller', id, actor });
        },
      },
    },
    config: { nodeEnv: 'test' },
  });

  const list = await request(app).get('/api/users').set('Authorization', 'Bearer token');
  const create = await request(app)
    .post('/api/users')
    .set('Authorization', 'Bearer token')
    .send({ name: 'Ana', username: 'ana', password: 'senha-segura-123' });
  const update = await request(app)
    .patch('/api/users/seller-1')
    .set('Authorization', 'Bearer token')
    .send({ name: 'Ana Vendas' });
  const disable = await request(app)
    .post('/api/users/seller-1/disable')
    .set('Authorization', 'Bearer token')
    .send({ password: 'confirm-disable' });
  const enable = await request(app).post('/api/users/seller-1/enable').set('Authorization', 'Bearer token');
  const remove = await request(app)
    .delete('/api/users/seller-1')
    .set('Authorization', 'Bearer token')
    .send({ password: 'confirm-delete' });

  assert.equal(list.status, 200);
  assert.equal(create.status, 201);
  assert.equal(update.status, 200);
  assert.equal(disable.body.active, false);
  assert.equal(enable.body.active, true);
  assert.equal(remove.status, 204);
  assert.equal(remove.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [
    { method: 'listSellers', actor: admin },
    {
      method: 'createSeller',
      input: { name: 'Ana', username: 'ana', password: 'senha-segura-123' },
      actor: admin,
    },
    { method: 'updateSeller', id: 'seller-1', input: { name: 'Ana Vendas' }, actor: admin },
    { method: 'confirmPassword', input: { id: 'admin-1', password: 'confirm-disable' } },
    { method: 'setSellerActive', id: 'seller-1', active: false, actor: admin },
    { method: 'setSellerActive', id: 'seller-1', active: true, actor: admin },
    { method: 'confirmPassword', input: { id: 'admin-1', password: 'confirm-delete' } },
    { method: 'deleteSeller', id: 'seller-1', actor: admin },
  ]);
});

test('seller deletion requires the actor password-confirmation service', async () => {
  const calls = [];
  const app = createApp({
    services: {
      auth: { verifyActor: async () => admin },
      session: { confirmPassword: async (input) => calls.push({ method: 'confirmPassword', input }) },
      users: { deleteSeller: async (id, actor) => calls.push({ method: 'deleteSeller', id, actor }) },
    },
    config: { nodeEnv: 'test' },
  });

  await request(app)
    .delete('/api/users/seller-1')
    .set('Authorization', 'Bearer token')
    .send({ password: 'confirm-delete' })
    .expect(204);

  assert.deepEqual(calls, [
    { method: 'confirmPassword', input: { id: 'admin-1', password: 'confirm-delete' } },
    { method: 'deleteSeller', id: 'seller-1', actor: admin },
  ]);
});

test('user router creates the Supabase-backed service when only server clients are supplied', async () => {
  const app = createApp({
    services: {
      authenticateRequest: async () => admin,
      adminClient: {
        auth: {
          admin: {
            createUser: async () => ({ data: { user: { id: 'seller-auth-id' } }, error: null }),
          },
        },
        from: (table) => {
          assert.equal(table, 'profiles');
          return {
            insert: (row) => ({
              select: () => ({ single: async () => ({ data: row, error: null }) }),
            }),
          };
        },
      },
    },
    config: { nodeEnv: 'test' },
  });

  const response = await request(app)
    .post('/api/users')
    .set('Authorization', 'Bearer token')
    .send({
      name: 'Ana', username: 'ana', password: 'senha-inicial-segura', phone: '',
    });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    id: 'seller-auth-id',
    name: 'Ana',
    username: 'ana',
    phone: '',
    active: true,
  });
});
