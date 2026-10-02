import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductService } from '../../src/server/services/product-service.js';

const admin = { id: 'admin-1', role: 'admin', active: true };
const productRow = {
  id: 'product-1',
  name: 'Cabo USB-C',
  commission_type: 'fixed',
  commission_rate_bps: null,
  commission_fixed_cents: 2000,
  active: true,
};
const productColumns = 'id, name, commission_type, commission_rate_bps, commission_fixed_cents, active';

function createQuery(result) {
  const query = {
    eq: () => query,
    order: () => Promise.resolve(result),
    select: () => ({
      single: async () => result,
      maybeSingle: async () => result,
    }),
  };
  return query;
}

test('product service creates and lists explicit public product fields with exact rule storage', async () => {
  const calls = [];
  const service = createProductService({
    adminClient: {
      from: (table) => ({
        select: (columns) => {
          calls.push({ method: 'select', table, columns });
          return createQuery({ data: [productRow], error: null });
        },
        insert: (row) => {
          calls.push({ method: 'insert', table, row });
          return { select: (columns) => ({ single: async () => {
            calls.push({ method: 'insert-select', table, columns });
            return { data: productRow, error: null };
          } }) };
        },
      }),
    },
  });

  const created = await service.create({
    actor: admin,
    input: { name: ' Cabo USB-C ', commissionType: 'fixed', commissionInput: '20,00' },
  });
  const listed = await service.list({ actor: admin });

  assert.deepEqual(created, {
    id: 'product-1', name: 'Cabo USB-C', commissionType: 'fixed', commissionInput: '20.00', active: true,
  });
  assert.deepEqual(listed, [created]);
  assert.deepEqual(calls, [
    {
      method: 'insert', table: 'products', row: {
        name: 'Cabo USB-C', commission_type: 'fixed', commission_rate_bps: null,
        commission_fixed_cents: 2000, active: true,
      },
    },
    { method: 'insert-select', table: 'products', columns: productColumns },
    { method: 'select', table: 'products', columns: productColumns },
  ]);
});

test('product service calls the protected rule RPC only for changed active product rules', async () => {
  const rpcCalls = [];
  let lookupCount = 0;
  const service = createProductService({
    adminClient: {
      from: (table) => {
        assert.equal(table, 'products');
        return {
          select: (columns) => {
            assert.equal(columns, productColumns);
            return {
              eq: () => ({ maybeSingle: async () => {
                lookupCount += 1;
                return {
                  data: lookupCount <= 2 ? productRow : {
                    ...productRow, name: 'Cabo USB-C Pro', commission_fixed_cents: 2500,
                  },
                  error: null,
                };
              } }),
            };
          },
        };
      },
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        return { data: [{ product_id: 'product-1', recalculated_pending_count: 3 }], error: null };
      },
    },
  });

  const unchanged = await service.update({
    actor: admin, id: 'product-1', input: { name: ' Cabo USB-C ' },
  });
  const changed = await service.update({
    actor: admin,
    id: 'product-1',
    input: { name: ' Cabo USB-C Pro ', commissionType: 'fixed', commissionInput: '25,00' },
  });

  assert.deepEqual(unchanged, {
    id: 'product-1', name: 'Cabo USB-C', commissionType: 'fixed', commissionInput: '20.00', active: true,
    recalculatedPendingCount: 0,
  });
  assert.deepEqual(changed, {
    id: 'product-1', name: 'Cabo USB-C Pro', commissionType: 'fixed', commissionInput: '25.00', active: true,
    recalculatedPendingCount: 3,
  });
  assert.deepEqual(rpcCalls, [{
    name: 'update_product_rule',
    args: {
      p_product_id: 'product-1', p_actor_id: 'admin-1', p_name: 'Cabo USB-C Pro',
      p_commission_type: 'fixed', p_commission_rate_bps: null, p_commission_fixed_cents: 2500,
    },
  }]);
});

test('product service updates a name without invoking rule recalculation', async () => {
  const updates = [];
  let rpcCalled = false;
  const service = createProductService({
    adminClient: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: productRow, error: null }) }) }),
        update: (row) => {
          updates.push(row);
          const query = {
            eq: () => query,
            select: () => ({ maybeSingle: async () => ({
              data: { ...productRow, ...row }, error: null,
            }) }),
          };
          return query;
        },
      }),
      rpc: async () => { rpcCalled = true; return { data: [], error: null }; },
    },
  });

  const updated = await service.update({
    actor: admin, id: 'product-1', input: { name: ' Cabo USB-C Pro ' },
  });

  assert.deepEqual(updates, [{ name: 'Cabo USB-C Pro' }]);
  assert.equal(rpcCalled, false);
  assert.deepEqual(updated, {
    id: 'product-1', name: 'Cabo USB-C Pro', commissionType: 'fixed', commissionInput: '20.00', active: true,
    recalculatedPendingCount: 0,
  });
});

test('product service rejects inactive products for rule mutation and only changes active state logically', async () => {
  const inactive = { ...productRow, active: false };
  const updates = [];
  const service = createProductService({
    adminClient: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: inactive, error: null }) }) }),
        update: (row) => {
          updates.push(row);
          const query = {
            eq: () => query,
            select: () => ({ maybeSingle: async () => ({ data: { ...productRow, ...row }, error: null }) }),
          };
          return query;
        },
      }),
    },
  });

  await assert.rejects(
    () => service.update({ actor: admin, id: 'product-1', input: { name: 'Outro' } }),
    (error) => error.status === 409 && error.code === 'PRODUCT_INACTIVE',
  );
  const activated = await service.setActive({ actor: admin, id: 'product-1', active: true });

  assert.deepEqual(updates, [{ active: true }]);
  assert.deepEqual(activated, {
    id: 'product-1', name: 'Cabo USB-C', commissionType: 'fixed', commissionInput: '20.00', active: true,
  });
});

test('product service removes a product through the atomic RPC', async () => {
  const calls = [];
  const service = createProductService({
    adminClient: {
      async rpc(name, args) {
        calls.push({ name, args });
        return { data: [{ deleted_product_id: 'product-1' }], error: null };
      },
    },
  });

  assert.deepEqual(await service.remove({ actor: admin, id: 'product-1' }), { id: 'product-1' });
  assert.deepEqual(calls, [{
    name: 'delete_product',
    args: { p_product_id: 'product-1', p_actor_id: 'admin-1' },
  }]);
});

test('product service maps usage conflicts and missing products on removal', async () => {
  const conflict = createProductService({
    adminClient: { rpc: async () => ({ data: null, error: { code: '23503' } }) },
  });
  await assert.rejects(
    () => conflict.remove({ actor: admin, id: 'product-1' }),
    (error) => error.status === 409 && error.code === 'PRODUCT_IN_USE',
  );

  const missing = createProductService({
    adminClient: { rpc: async () => ({ data: null, error: { code: 'P0002' } }) },
  });
  await assert.rejects(
    () => missing.remove({ actor: admin, id: 'missing-product' }),
    (error) => error.status === 404 && error.code === 'PRODUCT_NOT_FOUND',
  );
});
