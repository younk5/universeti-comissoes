import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import { AppError } from '../../src/server/errors.js';

const seller = { id: 'seller-a', role: 'seller', name: 'Ana', active: true };
const admin = { id: 'admin-1', role: 'admin', name: 'Admin', active: true };

function appFor(actor, commissions = {}, session) {
  return createApp({
    services: {
      auth: { verifyActor: async () => actor },
      commissions,
      ...(session ? { session } : {}),
    },
    config: { nodeEnv: 'test' },
  });
}

test('seller commissions are served through the actor-scoped service contract', async () => {
  const calls = [];
  const app = appFor(seller, {
    listCommissions: async (input) => {
      calls.push(input);
      return { items: [{ id: 'c-1', sellerId: input.actor.id }], pendingTotal: '0.00', paidTotal: '0.00' };
    },
  });

  const response = await request(app)
    .get('/api/commissions?sellerId=seller-b')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.items.map((item) => item.sellerId), ['seller-a']);
  assert.deepEqual(calls, [{
    actor: seller,
    filters: { sellerId: 'seller-b' },
  }]);
});

test('seller CSV is built only from actor-scoped service rows', async () => {
  const calls = [];
  const app = appFor(seller, {
    listCommissions: async (input) => {
      calls.push(input);
      return {
        items: [{
          sellerName: 'Ana',
          product: 'Plano',
          saleValue: '1234.56',
          commissionValue: '129.63',
          saleDate: '2026-09-08',
          paymentStatus: 'pending',
          note: '',
        }],
      };
    },
  });

  const response = await request(app)
    .get('/api/commissions/export.csv?sellerId=seller-b')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/csv; charset=utf-8/);
  assert.equal(response.text, '\uFEFFVendedor,Produto,Valor da venda,Comissão,Data,Status,Observação\r\nAna,Plano,1234.56,129.63,2026-09-08,pending,\r\n');
  assert.deepEqual(calls, [{ actor: seller, filters: { sellerId: 'seller-b' } }]);
});

test('seller cannot create, update, void, delete, or mark paid commissions', async () => {
  let administrativeServiceCalled = false;
  const app = appFor(seller, {
    create: async () => { administrativeServiceCalled = true; },
    update: async () => { administrativeServiceCalled = true; },
    voidCommission: async () => { administrativeServiceCalled = true; },
    deleteCommission: async () => { administrativeServiceCalled = true; },
    markPaid: async () => { administrativeServiceCalled = true; },
  });

  const [create, update, voided, deleted, paid] = await Promise.all([
    request(app).post('/api/commissions').set('Authorization', 'Bearer token').send({}),
    request(app).patch('/api/commissions/c-1').set('Authorization', 'Bearer token').send({}),
    request(app).post('/api/commissions/c-1/void').set('Authorization', 'Bearer token'),
    request(app).delete('/api/commissions/c-1').set('Authorization', 'Bearer token'),
    request(app).post('/api/commissions/mark-paid').set('Authorization', 'Bearer token').send({ ids: ['c-1'] }),
  ]);

  for (const response of [create, update, voided, deleted, paid]) assert.equal(response.status, 403);
  assert.equal(administrativeServiceCalled, false);
});

test('admin creates a commission through the authenticated service contract', async () => {
  const calls = [];
  const input = {
    sellerId: 'seller-a',
    productId: 'product-annual',
    product: 'Plano anual',
    saleValue: '1234.56',
    saleDate: '2026-09-08',
    note: '',
  };
  const app = appFor(admin, {
    create: async (requestInput) => {
      calls.push(requestInput);
      return { id: 'c-1', ...input, sellerName: 'Ana', paymentStatus: 'pending' };
    },
  });

  const response = await request(app)
    .post('/api/commissions')
    .set('Authorization', 'Bearer token')
    .send(input);

  assert.equal(response.status, 201);
  assert.equal(response.body.id, 'c-1');
  assert.deepEqual(calls, [{ actor: admin, input }]);
});

test('commission API submits forged rule fields to server validation instead of accepting an override', async () => {
  let received;
  const app = appFor(admin, {
    create: async ({ input }) => {
      received = input;
      throw new AppError('Dados da comissão inválidos.', { status: 400, code: 'INVALID_COMMISSION' });
    },
  });
  const input = {
    sellerId: 'seller-a', product: 'Plano anual', saleValue: '100.00', saleDate: '2026-09-08',
    commissionType: 'fixed', commissionInput: '0.01',
  };

  const response = await request(app)
    .post('/api/commissions')
    .set('Authorization', 'Bearer token')
    .send(input);

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { message: 'Dados da comissão inválidos.', code: 'INVALID_COMMISSION' });
  assert.deepEqual(received, input);
});

test('catalog-product validation errors stay public at the commission API boundary', async () => {
  const app = appFor(admin, {
    create: async () => {
      throw new AppError('Produto não encontrado.', { status: 404, code: 'PRODUCT_NOT_FOUND' });
    },
  });

  const response = await request(app)
    .post('/api/commissions')
    .set('Authorization', 'Bearer token')
    .send({ sellerId: 'seller-a', productId: 'missing-product', saleValue: '100.00', saleDate: '2026-09-08' });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { message: 'Produto não encontrado.', code: 'PRODUCT_NOT_FOUND' });
});

test('admin updates a commission through the authenticated service contract', async () => {
  const calls = [];
  const input = { product: 'Plano revisado' };
  const app = appFor(admin, {
    update: async (requestInput) => {
      calls.push(requestInput);
      return { id: requestInput.id, ...requestInput.input };
    },
  });

  const response = await request(app)
    .patch('/api/commissions/c-1')
    .set('Authorization', 'Bearer token')
    .send(input);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { id: 'c-1', product: 'Plano revisado' });
  assert.deepEqual(calls, [{ actor: admin, id: 'c-1', input }]);
});

test('admin delegates batch payment to the actor-bound RPC service contract', async () => {
  const calls = [];
  const app = appFor(admin, {
    markPaid: async (requestInput) => {
      calls.push(requestInput);
      return { paidIds: ['pending-1'], updatedCount: 1 };
    },
  });

  const response = await request(app)
    .post('/api/commissions/mark-paid')
    .set('Authorization', 'Bearer token')
    .send({ ids: ['pending-1', 'paid-2'] });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { paidIds: ['pending-1'], updatedCount: 1 });
  assert.deepEqual(calls, [{ actor: admin, commissionIds: ['pending-1', 'paid-2'] }]);
});

test('admin DELETE route confirms the current password before deleting a commission', async () => {
  const calls = [];
  const app = appFor(admin, {
    deleteCommission: async (requestInput) => calls.push({ method: 'deleteCommission', requestInput }),
  }, {
    confirmPassword: async (input) => calls.push({ method: 'confirmPassword', input }),
  });

  const response = await request(app)
    .delete('/api/commissions/c-1')
    .set('Authorization', 'Bearer token')
    .send({ password: 'confirm-commission' });

  assert.equal(response.status, 204);
  assert.equal(response.text, '');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [
    { method: 'confirmPassword', input: { id: 'admin-1', password: 'confirm-commission' } },
    { method: 'deleteCommission', requestInput: { actor: admin, id: 'c-1' } },
  ]);
});

test('admin void route confirms the current password before voiding a commission', async () => {
  const calls = [];
  const app = appFor(admin, {
    voidCommission: async (requestInput) => calls.push({ method: 'voidCommission', requestInput }),
  }, {
    confirmPassword: async (input) => calls.push({ method: 'confirmPassword', input }),
  });

  const response = await request(app)
    .post('/api/commissions/c-1/void')
    .set('Authorization', 'Bearer token')
    .send({ password: 'confirm-commission' });

  assert.equal(response.status, 204);
  assert.equal(response.text, '');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [
    { method: 'confirmPassword', input: { id: 'admin-1', password: 'confirm-commission' } },
    { method: 'voidCommission', requestInput: { actor: admin, id: 'c-1' } },
  ]);
});

test('wallet query forwards request filters to the actor-scoped service contract', async () => {
  const calls = [];
  const app = appFor(seller, {
    wallet: async (requestInput) => {
      calls.push(requestInput);
      return { pendingTotal: '100.00', paidTotal: '0.00', commissions: [], monthlyPaid: [] };
    },
  });

  const response = await request(app)
    .get('/api/wallet?sellerId=seller-b&paymentStatus=pending')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{
    actor: seller,
    filters: { sellerId: 'seller-b', paymentStatus: 'pending' },
  }]);
});
