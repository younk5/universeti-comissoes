const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMoney,
  calculateCommission,
  todayLocal,
} = require('../app.js');

test('normaliza formatos brasileiros e decimais', () => {
  assert.equal(normalizeMoney('1.234,56'), 1234.56);
  assert.equal(normalizeMoney('1234,56'), 1234.56);
  assert.equal(normalizeMoney('1234.56'), 1234.56);
  assert.ok(Number.isNaN(normalizeMoney('abc')));
});

test('calcula comissão percentual e fixa', () => {
  assert.equal(calculateCommission(1500, 'percentage', 8), 120);
  assert.equal(calculateCommission(1500, 'fixed', 225), 225);
});

test('gera data local no formato de campo date', () => {
  assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

const { createEmptyState, sanitizeState, validateSeller, sellerHasCommissions } = require('../app.js');

test('normaliza estado corrompido em coleções vazias', () => {
  assert.deepEqual(sanitizeState({ sellers: 'erro', commissions: null }), createEmptyState());
});

test('exige nome para cadastrar vendedor', () => {
  assert.deepEqual(validateSeller({ name: '   ', contact: '' }), {
    valid: false,
    error: 'Informe o nome do vendedor.',
  });
  assert.equal(validateSeller({ name: 'Ana', contact: 'ana@empresa.com' }).valid, true);
});

test('identifica vendedor com comissões vinculadas', () => {
  assert.equal(sellerHasCommissions({ commissions: [{ sellerId: 'v1' }] }, 'v1'), true);
  assert.equal(sellerHasCommissions({ commissions: [{ sellerId: 'v1' }] }, 'v2'), false);
});

const { validateCommission, createCommission } = require('../app.js');
const commissionSellers = [{ id: 'v1', name: 'Ana' }];

test('valida campos obrigatórios da comissão', () => {
  assert.deepEqual(validateCommission({
    sellerId: '', saleValue: '10', commissionType: 'fixed', commissionInput: '2', saleDate: '2026-09-07',
  }, commissionSellers), {
    valid: false,
    error: 'Selecione um vendedor.',
  });
  assert.equal(validateCommission({
    sellerId: 'v1', saleValue: '0', commissionType: 'fixed', commissionInput: '2', saleDate: '2026-09-07',
  }, commissionSellers).valid, false);
});

test('cria comissão percentual com valor congelado e nome histórico', () => {
  const commission = createCommission({
    sellerId: 'v1', product: 'Plano', saleValue: '2.000,00', commissionType: 'percentage',
    commissionInput: '7,5', saleDate: '2026-09-07', note: '',
  }, commissionSellers, '2026-09-07T12:00:00.000Z');
  assert.equal(commission.sellerName, 'Ana');
  assert.equal(commission.commissionValue, 150);
  assert.equal(commission.saleValue, 2000);
  assert.equal(commission.createdAt, '2026-09-07T12:00:00.000Z');
});

const { filterCommissions, sortCommissions, summarizeCommissions } = require('../app.js');
const history = [
  { id: 'c1', sellerId: 'v1', sellerName: 'Ana', saleDate: '2026-09-01', saleValue: 100, commissionValue: 10 },
  { id: 'c2', sellerId: 'v2', sellerName: 'Bruno', saleDate: '2026-09-05', saleValue: 300, commissionValue: 45 },
  { id: 'c3', sellerId: 'v1', sellerName: 'Ana', saleDate: '2026-09-10', saleValue: 200, commissionValue: 20 },
];

test('combina filtro de vendedor e período inclusivo', () => {
  assert.deepEqual(filterCommissions(history, {
    sellerId: 'v1', startDate: '2026-09-02', endDate: '2026-09-10',
  }).map((item) => item.id), ['c3']);
});

test('ordena cópia por comissão sem alterar a lista original', () => {
  const sorted = sortCommissions(history, 'commissionValue', 'desc');
  assert.deepEqual(sorted.map((item) => item.id), ['c2', 'c3', 'c1']);
  assert.equal(history[0].id, 'c1');
});

test('calcula total e subtotal por vendedor', () => {
  assert.deepEqual(summarizeCommissions(history), {
    total: 75,
    count: 3,
    bySeller: [
      { sellerId: 'v2', sellerName: 'Bruno', total: 45 },
      { sellerId: 'v1', sellerName: 'Ana', total: 30 },
    ],
  });
});

const { buildCommissionCsv } = require('../app.js');

test('gera CSV com BOM, ponto e vírgula e campos escapados', () => {
  const csv = buildCommissionCsv([{
    sellerName: 'Ana', product: 'Plano; Premium', saleValue: 1200,
    commissionValue: 120, saleDate: '2026-09-07', note: 'Disse "ok"',
  }]);
  assert.ok(csv.startsWith('\uFEFFVendedor;Produto ou serviço;Valor da venda;Valor da comissão;Data;Observação'));
  assert.match(csv, /"Plano; Premium"/);
  assert.match(csv, /"Disse ""ok"""/);
});
