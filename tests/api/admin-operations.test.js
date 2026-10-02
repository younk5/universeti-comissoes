import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const admin = { id: 'admin-1', role: 'admin', name: 'Admin', active: true };
const seller = { id: 'seller-1', role: 'seller', name: 'Ana', active: true };
const auth = { Authorization: 'Bearer token' };
const auditEvent = {
  id: 'event-1', eventType: 'paid', previousStatus: 'pending', newStatus: 'paid',
  occurredAt: '2026-09-09T12:00:00.000Z', commissionId: 'commission-1', sellerId: 'seller-1',
  sellerName: 'Ana', product: 'Plano', saleDate: '2026-09-08', commissionValue: '12.34', actorName: 'Admin',
};

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, uncompressedSize === 0 ? '' : inflateRawSync(compressed).toString('utf8'));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function appFor(actor, { commissions = {}, users = {} } = {}) {
  return createApp({
    services: {
      auth: { verifyActor: async () => actor },
      commissions,
      users,
    },
    config: { nodeEnv: 'test' },
  });
}

test('seller cannot read administrative audit events or backup', async () => {
  const app = appFor(seller, {
    commissions: {
      listAuditEvents: async () => ({ items: [] }),
      listCommissions: async () => ({ items: [] }),
    },
    users: { listSellers: async () => [] },
  });
  await request(app).get('/api/audit-events').set(auth).expect(403);
  await request(app).get('/api/admin/backup.xlsx').set(auth).expect(403);
});

test('admin audit route forwards the active commission filters', async () => {
  const calls = [];
  const app = appFor(admin, {
    commissions: {
      listAuditEvents: async (input) => { calls.push(input); return { items: [auditEvent] }; },
      listCommissions: async () => ({ items: [] }),
    },
    users: { listSellers: async () => [] },
  });
  const response = await request(app)
    .get('/api/audit-events?sellerId=seller-1&startDate=2026-09-01&endDate=2026-09-30&paymentStatus=paid')
    .set(auth)
    .expect(200);
  assert.deepEqual(response.body, { items: [auditEvent] });
  assert.deepEqual(calls, [{ actor: admin, filters: { sellerId: 'seller-1', startDate: '2026-09-01', endDate: '2026-09-30', paymentStatus: 'paid' } }]);
});

test('admin backup serves a formatted Excel workbook with archived operational records', async () => {
  const calls = [];
  const app = appFor(admin, {
    commissions: {
      listCommissions: async (input) => {
        calls.push({ method: 'listCommissions', input });
        return {
          items: [{
            id: 'commission-1',
            sellerName: 'Ana',
            product: 'Plano',
            saleValue: '1234.56',
            commissionValue: '129.63',
            saleDate: '2026-09-08',
            paymentStatus: 'paid',
            note: '',
            createdAt: '2026-09-08T12:00:00.000Z',
          }],
        };
      },
      listAuditEvents: async (input) => {
        calls.push({ method: 'listAuditEvents', input });
        return { items: [auditEvent] };
      },
    },
    users: {
      listSellers: async (actor, options) => {
        calls.push({ method: 'listSellers', actor, options });
        return [{ id: 'seller-1', name: 'Ana', username: 'ana', phone: '', active: true }];
      },
    },
  });

  const response = await request(app)
    .get('/api/admin/backup.xlsx')
    .set(auth)
    .buffer(true)
    .parse(binaryParser)
    .expect(200);

  assert.match(response.headers['content-type'], /spreadsheetml\.sheet/);
  assert.match(response.headers['content-disposition'], /galaxy-smart-backup\.xlsx/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.subarray(0, 2).toString('utf8'), 'PK');

  const entries = readZipEntries(response.body);
  const workbook = entries.get('xl/workbook.xml');
  for (const sheetName of ['Resumo', 'Vendedores', 'Comissões', 'Histórico']) {
    assert.match(workbook, new RegExp(`name="${sheetName}"`));
  }

  const allSheets = [...entries.entries()]
    .filter(([name]) => name.startsWith('xl/worksheets/'))
    .map(([, data]) => data)
    .join('');
  assert.match(allSheets, /Ana/);
  assert.match(allSheets, /Plano/);
  assert.match(allSheets, /129,63|129\.63/);
  assert.equal(allSheets.includes('@exemplo'), false);
  assert.equal(allSheets.includes('defaultCommissionRate'), false);

  assert.deepEqual(calls, [
    { method: 'listSellers', actor: admin, options: { includeArchived: true } },
    { method: 'listCommissions', input: { actor: admin, filters: {}, includeArchived: true } },
    { method: 'listAuditEvents', input: { actor: admin, filters: {} } },
  ]);
});
