import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildBackupWorkbook } from '../../src/server/domain/backup.js';

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

function sheetText(workbook) {
  const entries = readZipEntries(workbook);
  return [...entries.entries()]
    .filter(([name]) => name.startsWith('xl/worksheets/'))
    .map(([, data]) => data)
    .join('');
}

const commission = (overrides = {}) => ({
  id: 'c1',
  sellerName: 'Ana',
  product: 'Plano',
  saleValue: '1234.56',
  commissionValue: '129.63',
  saleDate: '2026-09-08',
  paymentStatus: 'paid',
  note: '',
  createdAt: '2026-09-08T12:00:00.000Z',
  ...overrides,
});

test('backup workbook summarizes totals and lists records across four sheets', () => {
  const workbook = buildBackupWorkbook({
    generatedAt: '2026-09-17T13:45:00.000Z',
    sellers: [{ id: 's1', name: 'Ana', username: 'ana', phone: '11988887777', active: true }],
    commissions: [
      commission(),
      commission({
        id: 'c2', product: 'Cabo', saleValue: '100.00', commissionValue: '10.00',
        saleDate: '2026-09-09', paymentStatus: 'pending', note: 'obs', createdAt: '2026-09-09T12:00:00.000Z',
      }),
    ],
    auditEvents: [
      {
        id: 'e1', eventType: 'paid', occurredAt: '2026-09-09T12:00:00.000Z',
        sellerName: 'Ana', product: 'Plano', commissionValue: '129.63', actorName: 'Admin',
      },
      {
        id: 'e2', eventType: 'archived', occurredAt: '2026-09-10T12:00:00.000Z',
        targetType: 'seller', targetName: 'Bia', actorName: 'Admin',
      },
    ],
  });

  const entries = readZipEntries(workbook);
  const workbookXml = entries.get('xl/workbook.xml');
  for (const name of ['Resumo', 'Vendedores', 'Comissões', 'Histórico']) {
    assert.match(workbookXml, new RegExp(`name="${name}"`));
  }

  const text = sheetText(workbook);
  assert.match(text, /17\/09\/2026 13:45/);
  assert.match(text, /R\$ 10,00/);
  assert.match(text, /R\$ 129,63/);
  assert.match(text, /R\$ 139,63/);
  assert.match(text, /11988887777/);
  assert.match(text, /08\/09\/2026/);
  assert.match(text, /Pendente/);
  assert.match(text, /Pagamento/);
  assert.match(text, /Arquivamento/);
  assert.match(text, /Perfil de vendedor/);
});

test('backup workbook ignores hidden account fields and marks inactive sellers', () => {
  const workbook = buildBackupWorkbook({
    generatedAt: '2026-09-17T13:45:00.000Z',
    sellers: [{
      id: 's1', name: 'Ana', username: 'ana', phone: '', active: false,
      email: 'ana@exemplo.com', defaultCommissionRate: 5,
    }],
    commissions: [],
    auditEvents: [],
  });

  const text = sheetText(workbook);
  assert.match(text, /Desativado/);
  assert.equal(text.includes('ana@exemplo.com'), false);
  assert.equal(text.includes('defaultCommissionRate'), false);
});

test('backup workbook handles an empty base without data rows', () => {
  const workbook = buildBackupWorkbook({ generatedAt: '2026-09-17T13:45:00.000Z' });
  const text = sheetText(workbook);
  assert.match(text, /R\$ 0,00/);
  assert.match(text, /Vendedores/);
  assert.equal(text.includes('undefined'), false);
});