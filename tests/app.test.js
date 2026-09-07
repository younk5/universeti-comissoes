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
