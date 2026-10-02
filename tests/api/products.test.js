import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const admin = { id: 'admin-1', role: 'admin', active: true };
const product = {
  id: 'product-1', name: 'Cabo USB-C', commissionType: 'fixed', commissionInput: '20.00', active: true,
};

test('active administrator uses every product route with only the authenticated actor', async () => {
  const calls = [];
  const app = createApp({
    services: {
      auth: { verifyActor: async () => admin },
      session: {
        confirmPassword: async (input) => calls.push({ method: 'confirmPassword', input }),
      },
      products: {
        list: async (input) => { calls.push({ method: 'list', input }); return [product]; },
        create: async (input) => { calls.push({ method: 'create', input }); return product; },
        update: async (input) => { calls.push({ method: 'update', input }); return { ...product, recalculatedPendingCount: 2 }; },
        setActive: async (input) => { calls.push({ method: 'setActive', input }); return { ...product, active: input.active }; },
        remove: async (input) => { calls.push({ method: 'remove', input }); return { id: input.id }; },
      },
    },
    config: { nodeEnv: 'test' },
  });
  const auth = { Authorization: 'Bearer token' };

  const list = await request(app).get('/api/products?includeInactive=true').set(auth);
  const create = await request(app).post('/api/products').set(auth).send({
    name: 'Cabo USB-C', commissionType: 'fixed', commissionInput: '20', actorId: 'forged',
  });
  const update = await request(app).patch('/api/products/product-1').set(auth).send({
    name: 'Cabo USB-C Pro', commissionType: 'fixed', commissionInput: '25', actorId: 'forged',
  });
  const deactivate = await request(app).post('/api/products/product-1/deactivate').set(auth);
  const activate = await request(app).post('/api/products/product-1/activate').set(auth);
  const remove = await request(app)
    .delete('/api/products/product-1')
    .set(auth)
    .send({ password: 'confirm-product' });

  assert.equal(list.status, 200);
  assert.equal(create.status, 201);
  assert.equal(update.status, 200);
  assert.equal(deactivate.body.active, false);
  assert.equal(activate.body.active, true);
  assert.equal(remove.status, 204);
  assert.equal(remove.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [
    { method: 'list', input: { actor: admin, includeInactive: true } },
    {
      method: 'create', input: {
        actor: admin,
        input: { name: 'Cabo USB-C', commissionType: 'fixed', commissionInput: '20' },
      },
    },
    {
      method: 'update', input: {
        actor: admin, id: 'product-1',
        input: { name: 'Cabo USB-C Pro', commissionType: 'fixed', commissionInput: '25' },
      },
    },
    { method: 'setActive', input: { actor: admin, id: 'product-1', active: false } },
    { method: 'setActive', input: { actor: admin, id: 'product-1', active: true } },
    { method: 'confirmPassword', input: { id: 'admin-1', password: 'confirm-product' } },
    { method: 'remove', input: { actor: admin, id: 'product-1' } },
  ]);
});

test('seller and inactive administrators receive 403 from every product route', async () => {
  for (const actor of [
    { id: 'seller-1', role: 'seller', active: true },
    { id: 'admin-2', role: 'admin', active: false },
  ]) {
    let called = false;
    const app = createApp({
      services: {
        auth: { verifyActor: async () => actor },
        products: {
          list: async () => { called = true; return []; },
          create: async () => { called = true; return product; },
          update: async () => { called = true; return product; },
          setActive: async () => { called = true; return product; },
          remove: async () => { called = true; return { id: 'product-1' }; },
        },
      },
      config: { nodeEnv: 'test' },
    });
    const auth = { Authorization: 'Bearer token' };

    await request(app).get('/api/products').set(auth).expect(403);
    await request(app).post('/api/products').set(auth).send({}).expect(403);
    await request(app).patch('/api/products/product-1').set(auth).send({}).expect(403);
    await request(app).post('/api/products/product-1/deactivate').set(auth).expect(403);
    await request(app).post('/api/products/product-1/activate').set(auth).expect(403);
    await request(app).delete('/api/products/product-1').set(auth).expect(403);
    assert.equal(called, false);
  }
});
