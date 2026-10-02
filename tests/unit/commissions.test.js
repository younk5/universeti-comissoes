import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthlyPaidSeries,
  calculateCommission,
  calculateCommissionCents,
  serializeCommission,
  summarizeCommissions,
} from '../../src/server/domain/commissions.js';
import { createCommissionService } from '../../src/server/services/commission-service.js';

const adminActor = { id: 'admin-1', role: 'admin', active: true };
const sellerActor = { id: 'seller-a', role: 'seller', active: true };
const commissionColumns = [
  'id',
  'seller_id',
  'seller_name_snapshot',
  'product_id',
  'product',
  'sale_value_cents',
  'commission_type',
  'commission_rate_bps',
  'commission_fixed_cents',
  'commission_value_cents',
  'sale_date',
  'status',
  'paid_at',
  'note',
  'created_at',
  'updated_at',
].join(', ');

function commissionRow(overrides = {}) {
  return {
    id: 'commission-1',
    seller_id: 'seller-a',
    seller_name_snapshot: 'Ana',
    product_id: null,
    product: 'Plano anual',
    sale_value_cents: 123456,
    commission_type: 'percentage',
    commission_rate_bps: 1050,
    commission_fixed_cents: null,
    commission_value_cents: 12963,
    sale_date: '2026-09-08',
    status: 'pending',
    paid_at: null,
    note: 'Renovação',
    created_at: '2026-09-08T12:00:00.000Z',
    updated_at: '2026-09-08T12:00:00.000Z',
    ...overrides,
  };
}

function thenable(data, error = null) {
  return {
    then(onFulfilled, onRejected) {
      return Promise.resolve({ data, error }).then(onFulfilled, onRejected);
    },
  };
}

function fakeAdmin({
  seller = { id: 'seller-a', display_name: 'Ana', role: 'seller', active: true },
  commissions = [],
  currentCommission = commissionRow(),
  insertedCommission = commissionRow(),
  updatedCommission = commissionRow({ product: 'Plano revisado' }),
  product = null,
  paymentEvents = [],
  archiveEvents = [],
  actorProfiles = [],
  rpcData = [],
  rpcError = null,
} = {}) {
  const fake = {
    databaseCallCount: 0,
    lastQuery: null,
    lastInsert: null,
    lastUpdate: null,
    lastRpc: null,
    from(table) {
      fake.databaseCallCount += 1;
      if (table === 'profiles') {
        const filters = {};
        const profileQuery = {
          select(columns) {
            fake.lastProfileQuery = { columns, filters };
            return profileQuery;
          },
          eq(column, value) {
            filters[column] = value;
            return profileQuery;
          },
          in(column, values) {
            filters[`${column}:in`] = values;
            return profileQuery;
          },
          async maybeSingle() {
            return { data: seller, error: null };
          },
          then(onFulfilled, onRejected) {
            return thenable(actorProfiles).then(onFulfilled, onRejected);
          },
        };
        return profileQuery;
      }

      if (table === 'commission_payment_events') {
        const filters = {};
        const ordering = [];
        const paymentEventQuery = {
          select(columns) {
            fake.lastPaymentEventQuery = { columns, filters, ordering };
            return paymentEventQuery;
          },
          in(column, values) {
            filters[`${column}:in`] = values;
            return paymentEventQuery;
          },
          order(column, options) {
            ordering.push({ column, options });
            return paymentEventQuery;
          },
          then(onFulfilled, onRejected) {
            return thenable(paymentEvents).then(onFulfilled, onRejected);
          },
        };
        return paymentEventQuery;
      }

      if (table === 'profile_archive_events') {
        const filters = {};
        const ordering = [];
        const archiveEventQuery = {
          select(columns) {
            fake.lastArchiveEventQuery = { columns, filters, ordering };
            return archiveEventQuery;
          },
          eq(column, value) {
            filters[column] = value;
            return archiveEventQuery;
          },
          gte(column, value) {
            filters[`${column}:gte`] = value;
            return archiveEventQuery;
          },
          lte(column, value) {
            filters[`${column}:lte`] = value;
            return archiveEventQuery;
          },
          order(column, options) {
            ordering.push({ column, options });
            return archiveEventQuery;
          },
          then(onFulfilled, onRejected) {
            return thenable(archiveEvents).then(onFulfilled, onRejected);
          },
        };
        return archiveEventQuery;
      }

      if (table === 'products') {
        const filters = {};
        const productQuery = {
          select(columns) {
            fake.lastProductQuery = { columns, filters };
            return productQuery;
          },
          eq(column, value) {
            filters[column] = value;
            return productQuery;
          },
          async maybeSingle() {
            return { data: product, error: null };
          },
        };
        return productQuery;
      }

      assert.equal(table, 'commissions');
      const filters = {};
      const ordering = [];
      const readQuery = {
        select(columns) {
          fake.lastQuery = { columns, filters, ordering };
          return readQuery;
        },
        eq(column, value) {
          filters[column] = value;
          return readQuery;
        },
        neq(column, value) {
          filters[`${column}:neq`] = value;
          return readQuery;
        },
        gte(column, value) {
          filters[`${column}:gte`] = value;
          return readQuery;
        },
        lte(column, value) {
          filters[`${column}:lte`] = value;
          return readQuery;
        },
        order(column, options) {
          ordering.push({ column, options });
          return readQuery;
        },
        maybeSingle: async () => ({ data: currentCommission, error: null }),
        then(onFulfilled, onRejected) {
          return thenable(commissions).then(onFulfilled, onRejected);
        },
      };
      return {
        select: readQuery.select,
        insert(row) {
          fake.lastInsert = row;
          return {
            select(columns) {
              fake.lastInsert.columns = columns;
              return { single: async () => ({ data: insertedCommission, error: null }) };
            },
          };
        },
        update(row) {
          const updateFilters = {};
          fake.lastUpdate = { row, filters: updateFilters };
          const updateQuery = {
            eq(column, value) {
              updateFilters[column] = value;
              return updateQuery;
            },
            select(columns) {
              fake.lastUpdate.columns = columns;
              return { maybeSingle: async () => ({ data: updatedCommission, error: null }) };
            },
          };
          return updateQuery;
        },
      };
    },
    async rpc(name, args) {
      fake.databaseCallCount += 1;
      fake.lastRpc = { name, args };
      return { data: rpcData, error: rpcError };
    },
  };
  return fake;
}

test('calcula comissão percentual e conserva valor calculado', () => {
  assert.equal(calculateCommission({ saleValue: 1200, commissionType: 'percentage', commissionInput: 10 }), 120);
});

test('percentage calculation rounds only at the final cent', () => {
  assert.equal(calculateCommissionCents({
    saleValueCents: 999,
    commissionType: 'percentage',
    commissionRateBps: 1050,
    commissionFixedCents: null,
  }), 105);
});

test('serializeCommission converts database integers to exact view strings', () => {
  assert.deepEqual(serializeCommission(commissionRow()), {
    id: 'commission-1',
    sellerId: 'seller-a',
    sellerName: 'Ana',
    productId: null,
    product: 'Plano anual',
    saleValue: '1234.56',
    commissionType: 'percentage',
    commissionInput: 10.5,
    commissionValue: '129.63',
    saleDate: '2026-09-08',
    paymentStatus: 'pending',
    paidAt: null,
    note: 'Renovação',
    createdAt: '2026-09-08T12:00:00.000Z',
    updatedAt: '2026-09-08T12:00:00.000Z',
  });
});

test('summaries and monthly series preserve decimal strings beyond Number precision', () => {
  const commissions = Array.from({ length: 11 }, () => ({
    saleDate: '2026-09-08',
    commissionValue: '8999999999999.99',
    paymentStatus: 'paid',
  }));

  assert.deepEqual(summarizeCommissions(commissions), {
    pendingTotal: '0.00',
    paidTotal: '98999999999999.89',
  });
  assert.deepEqual(buildMonthlyPaidSeries(commissions), [{
    month: '2026-09', total: '98999999999999.89',
  }]);
});

test('seller scope is forced even when request supplies another sellerId', async () => {
  const adminClient = fakeAdmin();
  const service = createCommissionService({ adminClient });

  await service.listCommissions({ actor: sellerActor, filters: { sellerId: 'seller-b' } });

  assert.equal(adminClient.lastQuery.filters.seller_id, sellerActor.id);
  assert.equal(adminClient.lastQuery.filters['status:neq'], 'voided');
});

test('listCommissions selects explicit database fields and serializes exact money strings', async () => {
  const expensiveRow = commissionRow({
    sale_value_cents: '899999999999999',
    commission_value_cents: '899999999999999',
  });
  const adminClient = fakeAdmin({ commissions: [expensiveRow] });
  const service = createCommissionService({ adminClient });

  const result = await service.listCommissions({
    actor: adminActor,
    filters: {
      sellerId: 'seller-a',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      paymentStatus: 'pending',
    },
  });

  assert.equal(adminClient.lastQuery.columns, commissionColumns);
  assert.equal(adminClient.lastQuery.columns.includes('*'), false);
  assert.deepEqual(adminClient.lastQuery.filters, {
    seller_id: 'seller-a',
    'sale_date:gte': '2026-09-01',
    'sale_date:lte': '2026-09-30',
    status: 'pending',
  });
  assert.equal(result.items[0].saleValue, '8999999999999.99');
  assert.equal(result.items[0].commissionValue, '8999999999999.99');
  assert.deepEqual(result, {
    items: [serializeCommission(expensiveRow)],
    pendingTotal: '8999999999999.99',
    paidTotal: '0.00',
  });
});

test('listAuditEvents returns paid and voided events newest first with exact public commission data', async () => {
  const commissions = [
    commissionRow({
      id: 'commission-paid',
      seller_name_snapshot: 'Ana do snapshot',
      product: 'Plano inicial',
      commission_value_cents: '899999999999999',
    }),
    commissionRow({
      id: 'commission-voided',
      seller_id: 'seller-b',
      seller_name_snapshot: 'Bruna do snapshot',
      product: 'Plano premium',
      commission_value_cents: 1234,
      sale_date: '2026-09-09',
    }),
  ];
  const adminClient = fakeAdmin({
    commissions,
    paymentEvents: [
      {
        id: 'event-voided', commission_id: 'commission-voided', actor_id: 'admin-2',
        event_type: 'voided', previous_status: 'pending', new_status: 'voided',
        created_at: '2026-09-10T10:00:00.000Z',
      },
      {
        id: 'event-paid', commission_id: 'commission-paid', actor_id: 'admin-1',
        event_type: 'paid', previous_status: 'pending', new_status: 'paid',
        created_at: '2026-09-09T12:00:00.000Z',
      },
    ],
    actorProfiles: [
      { id: 'admin-1', display_name: 'Admin público' },
      { id: 'admin-2', display_name: 'Gestora pública' },
    ],
  });
  const service = createCommissionService({ adminClient });

  const result = await service.listAuditEvents({ actor: adminActor, filters: {} });

  assert.deepEqual(adminClient.lastPaymentEventQuery, {
    columns: 'id, commission_id, actor_id, event_type, previous_status, new_status, created_at',
    filters: { 'commission_id:in': ['commission-paid', 'commission-voided'] },
    ordering: [{ column: 'created_at', options: { ascending: false } }],
  });
  assert.equal(adminClient.lastProfileQuery.columns, 'id, display_name');
  assert.equal(adminClient.lastProfileQuery.columns.includes('email'), false);
  assert.deepEqual(result, {
    items: [
      {
        id: 'event-voided', eventType: 'voided', previousStatus: 'pending', newStatus: 'voided',
        occurredAt: '2026-09-10T10:00:00.000Z', commissionId: 'commission-voided', sellerId: 'seller-b',
        sellerName: 'Bruna do snapshot', product: 'Plano premium', saleDate: '2026-09-09',
        commissionValue: '12.34', actorName: 'Gestora pública',
      },
      {
        id: 'event-paid', eventType: 'paid', previousStatus: 'pending', newStatus: 'paid',
        occurredAt: '2026-09-09T12:00:00.000Z', commissionId: 'commission-paid', sellerId: 'seller-a',
        sellerName: 'Ana do snapshot', product: 'Plano inicial', saleDate: '2026-09-08',
        commissionValue: '8999999999999.99', actorName: 'Admin público',
      },
    ],
  });
});

test('listAuditEvents includes durable seller and administrator archives when no commission rows match', async () => {
  const adminClient = fakeAdmin({
    commissions: [],
    archiveEvents: [
      {
        id: 'archive-admin', actor_id: 'admin-1', target_id: 'admin-2', target_role: 'admin',
        target_display_name: 'Bia Admin', archived_at: '2026-09-10T11:00:00.000Z',
      },
      {
        id: 'archive-seller', actor_id: 'admin-1', target_id: 'seller-a', target_role: 'seller',
        target_display_name: 'Ana Vendas', archived_at: '2026-09-10T10:00:00.000Z',
      },
    ],
    actorProfiles: [{ id: 'admin-1', display_name: 'Admin público' }],
  });
  const service = createCommissionService({ adminClient });

  const result = await service.listAuditEvents({ actor: adminActor, filters: {} });

  assert.deepEqual(adminClient.lastArchiveEventQuery, {
    columns: 'id, actor_id, target_id, target_role, target_display_name, archived_at',
    filters: {},
    ordering: [{ column: 'archived_at', options: { ascending: false } }],
  });
  assert.deepEqual(result, {
    items: [
      {
        id: 'archive-admin', eventType: 'archived', occurredAt: '2026-09-10T11:00:00.000Z',
        targetType: 'admin', targetId: 'admin-2', targetName: 'Bia Admin', actorName: 'Admin público',
      },
      {
        id: 'archive-seller', eventType: 'archived', occurredAt: '2026-09-10T10:00:00.000Z',
        targetType: 'seller', targetId: 'seller-a', targetName: 'Ana Vendas', actorName: 'Admin público',
      },
    ],
  });
});

test('listAuditEvents uses a public fallback when an event actor profile is unavailable', async () => {
  const adminClient = fakeAdmin({
    commissions: [commissionRow()],
    paymentEvents: [{
      id: 'event-missing-actor', commission_id: 'commission-1', actor_id: 'removed-admin',
      event_type: 'paid', previous_status: 'pending', new_status: 'paid',
      created_at: '2026-09-09T12:00:00.000Z',
    }],
  });
  const service = createCommissionService({ adminClient });

  const result = await service.listAuditEvents({ actor: adminActor, filters: {} });

  assert.equal(result.items[0].actorName, 'Não informado');
});

test('create delegates no-product commissions to the default-rule locking RPC', async () => {
  const adminClient = fakeAdmin({ rpcData: [commissionRow()] });
  const service = createCommissionService({ adminClient });

  const result = await service.create({
    actor: adminActor,
    input: {
      sellerId: 'seller-a',
      product: 'Plano anual',
      saleValue: '1234.56',
      saleDate: '2026-09-08',
      note: 'Renovação',
    },
  });

  assert.deepEqual(adminClient.lastRpc, {
    name: 'upsert_default_backed_commission',
    args: {
      p_commission_id: null,
      p_actor_id: adminActor.id,
      p_seller_id: 'seller-a',
      p_seller_name_snapshot: 'Ana',
      p_product: 'Plano anual',
      p_sale_value_cents: 123456,
      p_sale_date: '2026-09-08',
      p_note: 'Renovação',
    },
  });
  assert.equal(adminClient.lastInsert, null);
  assert.equal(result.commissionValue, '129.63');
});

test('create rejects forged commission rule fields before database mutation', async () => {
  for (const forgedField of ['commissionType', 'commissionInput']) {
    const adminClient = fakeAdmin();
    const service = createCommissionService({ adminClient });

    await assert.rejects(
      () => service.create({
        actor: adminActor,
        input: {
          sellerId: 'seller-a', product: 'Plano anual', saleValue: '1234.56',
          saleDate: '2026-09-08', note: 'Renovação', [forgedField]: 'fixed',
        },
      }),
      (error) => error.status === 400 && error.code === 'INVALID_COMMISSION',
    );
    assert.equal(adminClient.databaseCallCount, 0);
  }
});

test('create translates an unconfigured default rule into an actionable public conflict', async () => {
  const adminClient = fakeAdmin({ rpcError: { code: 'P0001' } });
  const service = createCommissionService({ adminClient });

  await assert.rejects(
    () => service.create({
      actor: adminActor,
      input: {
        sellerId: 'seller-a', product: 'Plano anual', saleValue: '1234.56',
        saleDate: '2026-09-08', note: 'Renovação',
      },
    }),
    (error) => error.status === 409
      && error.code === 'DEFAULT_COMMISSION_RULE_UNCONFIGURED'
      && error.message.includes('Produtos'),
  );
});

test('update delegates no-product commissions to the default-rule locking RPC', async () => {
  const adminClient = fakeAdmin({ rpcData: [commissionRow({ product: 'Plano revisado', sale_value_cents: 100000 })] });
  const service = createCommissionService({ adminClient });

  await service.update({
    actor: adminActor,
    id: 'commission-1',
    input: { product: 'Plano revisado', saleValue: '1000.00' },
  });

  assert.deepEqual(adminClient.lastRpc, {
    name: 'upsert_default_backed_commission',
    args: {
      p_commission_id: 'commission-1',
      p_actor_id: adminActor.id,
      p_seller_id: 'seller-a',
      p_seller_name_snapshot: 'Ana',
      p_product: 'Plano revisado',
      p_sale_value_cents: 100000,
      p_sale_date: '2026-09-08',
      p_note: 'Renovação',
    },
  });
  assert.equal(adminClient.lastUpdate, null);
});

test('update transitions a pending product-backed commission to the default-rule locking RPC', async () => {
  const productId = '6fb92d2d-f53d-4902-a701-aa279df05874';
  const adminClient = fakeAdmin({
    currentCommission: commissionRow({
      product_id: productId,
      product: 'Produto do catálogo',
      commission_type: 'fixed',
      commission_rate_bps: null,
      commission_fixed_cents: 6789,
    }),
    rpcData: [commissionRow({
      product_id: null,
      product: 'Serviço manual',
      sale_value_cents: 100000,
      commission_type: 'percentage',
      commission_rate_bps: 1050,
      commission_fixed_cents: null,
    })],
  });
  const service = createCommissionService({ adminClient });

  const result = await service.update({
    actor: adminActor,
    id: 'commission-1',
    input: { productId: null, product: 'Serviço manual', saleValue: '1000.00' },
  });

  assert.deepEqual(adminClient.lastRpc, {
    name: 'upsert_default_backed_commission',
    args: {
      p_commission_id: 'commission-1',
      p_actor_id: adminActor.id,
      p_seller_id: 'seller-a',
      p_seller_name_snapshot: 'Ana',
      p_product: 'Serviço manual',
      p_sale_value_cents: 100000,
      p_sale_date: '2026-09-08',
      p_note: 'Renovação',
    },
  });
  assert.equal(adminClient.lastUpdate, null);
  assert.equal(adminClient.lastProductQuery, undefined);
  assert.equal(result.productId, null);
});

test('create delegates product-backed snapshots to the product-locking RPC', async () => {
  const catalogProduct = {
    id: '2e415a09-ef2f-4f4c-93e1-94409f6f5422',
    name: 'Produto autorizado',
    commission_type: 'fixed',
    commission_rate_bps: null,
    commission_fixed_cents: 6789,
    active: true,
  };
  const adminClient = fakeAdmin({
    rpcData: [commissionRow({
      product_id: catalogProduct.id,
      product: catalogProduct.name,
      commission_type: 'fixed',
      commission_rate_bps: null,
      commission_fixed_cents: 6789,
    })],
  });
  const service = createCommissionService({ adminClient });

  const result = await service.create({
    actor: adminActor,
    input: {
      sellerId: 'seller-a',
      productId: catalogProduct.id,
      product: 'Texto manipulado pelo navegador',
      saleValue: '1234.56',
      saleDate: '2026-09-08',
      note: 'Renovação',
    },
  });

  assert.deepEqual(adminClient.lastRpc, {
    name: 'upsert_product_backed_commission',
    args: {
      p_commission_id: null,
      p_actor_id: adminActor.id,
      p_seller_id: 'seller-a',
      p_seller_name_snapshot: 'Ana',
      p_product_id: catalogProduct.id,
      p_sale_value_cents: 123456,
      p_sale_date: '2026-09-08',
      p_note: 'Renovação',
    },
  });
  assert.equal(adminClient.lastInsert, null);
  assert.equal(adminClient.lastProductQuery, undefined);
  assert.equal(result.productId, catalogProduct.id);
});

test('create rejects a missing or inactive catalog product without persisting a commission', async () => {
  const adminClient = fakeAdmin({ product: null });
  const service = createCommissionService({ adminClient });

  await assert.rejects(
    () => service.create({
      actor: adminActor,
      input: {
        sellerId: 'seller-a', productId: '3d512d21-f3a1-467a-a095-6a60d084ea34', saleValue: '1234.56', saleDate: '2026-09-08',
      },
    }),
    (error) => error.status === 404 && error.code === 'PRODUCT_NOT_FOUND',
  );
  assert.equal(adminClient.lastInsert, null);
});

test('update rejects a malformed supplied product id before database queries', async () => {
  const adminClient = fakeAdmin();
  const service = createCommissionService({ adminClient });

  await assert.rejects(
    () => service.update({
      actor: adminActor,
      id: 'commission-1',
      input: { productId: 'not-a-uuid' },
    }),
    (error) => error.status === 400 && error.code === 'INVALID_COMMISSION',
  );

  assert.equal(adminClient.databaseCallCount, 0);
});

test('update delegates product-backed snapshots to the product-locking RPC', async () => {
  const catalogProduct = {
    id: '6fb92d2d-f53d-4902-a701-aa279df05874',
    name: 'Produto percentual autorizado',
    commission_type: 'percentage',
    commission_rate_bps: 2450,
    commission_fixed_cents: null,
    active: true,
  };
  const adminClient = fakeAdmin({
    product: catalogProduct,
    rpcData: [commissionRow({
      product_id: catalogProduct.id,
      product: catalogProduct.name,
      commission_rate_bps: 2450,
    })],
  });
  const service = createCommissionService({ adminClient });

  await service.update({
    actor: adminActor,
    id: 'commission-1',
    input: {
      productId: catalogProduct.id,
      product: 'Produto manipulado',
    },
  });

  assert.deepEqual(adminClient.lastRpc, {
    name: 'upsert_product_backed_commission',
    args: {
      p_commission_id: 'commission-1',
      p_actor_id: adminActor.id,
      p_seller_id: 'seller-a',
      p_seller_name_snapshot: 'Ana',
      p_product_id: catalogProduct.id,
      p_sale_value_cents: 123456,
      p_sale_date: '2026-09-08',
      p_note: 'Renovação',
    },
  });
  assert.equal(adminClient.lastUpdate, null);
  assert.equal(adminClient.lastProductQuery, undefined);
});

test('update keeps paid and voided catalog commissions immutable', async () => {
  for (const status of ['paid', 'voided']) {
    const adminClient = fakeAdmin({ currentCommission: commissionRow({
      status,
      product_id: 'product-1',
    }) });
    const service = createCommissionService({ adminClient });

    await assert.rejects(
      () => service.update({ actor: adminActor, id: 'commission-1', input: { productId: 'product-2' } }),
      (error) => error.status === 400 && error.code === 'INVALID_COMMISSION',
    );
    assert.equal(adminClient.lastUpdate, null);
    assert.equal(adminClient.lastProductQuery, undefined);
  }
});

test('markPaid delegates one atomic RPC and maps only updated commission ids', async () => {
  const adminClient = fakeAdmin({ rpcData: [{ commission_id: 'a' }] });
  const service = createCommissionService({ adminClient });

  const result = await service.markPaid({ actor: adminActor, commissionIds: ['a', 'b', 'a'] });

  assert.deepEqual(adminClient.lastRpc, {
    name: 'mark_commissions_paid',
    args: { p_commission_ids: ['a', 'b'], p_actor_id: adminActor.id },
  });
  assert.deepEqual(result, { paidIds: ['a'], updatedCount: 1 });
});

test('markPaid treats an empty RPC response as a successful idempotent payment', async () => {
  const adminClient = fakeAdmin({ rpcData: [] });
  const service = createCommissionService({ adminClient });

  assert.deepEqual(
    await service.markPaid({ actor: adminActor, commissionIds: ['already-paid'] }),
    { paidIds: [], updatedCount: 0 },
  );
});

test('markPaid rejects sellers before calling the privileged RPC', async () => {
  const adminClient = fakeAdmin();
  const service = createCommissionService({ adminClient });

  await assert.rejects(
    () => service.markPaid({ actor: sellerActor, commissionIds: ['commission-1'] }),
    (error) => error.status === 403 && error.code === 'ADMIN_REQUIRED',
  );
  assert.equal(adminClient.lastRpc, null);
});

test('voidCommission delegates the pending-only cancellation to one atomic RPC', async () => {
  const adminClient = fakeAdmin({ rpcData: [{ commission_id: 'commission-1' }] });
  const service = createCommissionService({ adminClient });

  assert.deepEqual(
    await service.voidCommission({ actor: adminActor, id: 'commission-1' }),
    { voidedId: 'commission-1' },
  );
  assert.deepEqual(adminClient.lastRpc, {
    name: 'void_commission',
    args: { p_commission_id: 'commission-1', p_actor_id: adminActor.id },
  });
});

test('voidCommission rejects sellers without a direct commission delete', async () => {
  const adminClient = fakeAdmin();
  const service = createCommissionService({ adminClient });

  await assert.rejects(
    () => service.voidCommission({ actor: sellerActor, id: 'commission-1' }),
    (error) => error.status === 403 && error.code === 'ADMIN_REQUIRED',
  );
  assert.equal(adminClient.lastRpc, null);
  assert.equal('delete' in adminClient, false);
});

test('deleteCommission delegates the irreversible removal to one atomic RPC', async () => {
  const adminClient = fakeAdmin({ rpcData: [{ deleted_commission_id: 'commission-1' }] });
  const service = createCommissionService({ adminClient });

  assert.deepEqual(
    await service.deleteCommission({ actor: adminActor, id: 'commission-1' }),
    { deletedId: 'commission-1' },
  );
  assert.deepEqual(adminClient.lastRpc, {
    name: 'delete_commission',
    args: { p_commission_id: 'commission-1', p_actor_id: adminActor.id },
  });
});

test('deleteCommission reports a missing commission and rejects sellers', async () => {
  const missingClient = fakeAdmin({ rpcError: { code: 'P0002' } });
  const missingService = createCommissionService({ adminClient: missingClient });

  await assert.rejects(
    () => missingService.deleteCommission({ actor: adminActor, id: 'missing-commission' }),
    (error) => error.status === 404 && error.code === 'COMMISSION_NOT_FOUND',
  );

  const sellerClient = fakeAdmin();
  const sellerService = createCommissionService({ adminClient: sellerClient });
  await assert.rejects(
    () => sellerService.deleteCommission({ actor: sellerActor, id: 'commission-1' }),
    (error) => error.status === 403 && error.code === 'ADMIN_REQUIRED',
  );
  assert.equal(sellerClient.lastRpc, null);
});
