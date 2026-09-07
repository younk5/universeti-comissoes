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
