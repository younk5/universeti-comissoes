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
