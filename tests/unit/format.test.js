import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatDate, formatPercent } from '../../src/client/format.js';

test('formatadores usam a localidade pt-BR para moeda e data', () => {
  assert.match(formatCurrency('1234.50'), /^R\$\s*1\.234,50$/);
  assert.equal(formatDate('2026-09-07T12:00:00.000Z'), '07/09/2026');
});

test('formatCurrency preserva cada centavo de strings decimais acima da precisão de Number', () => {
  assert.equal(formatCurrency('90071992547409.91'), 'R$ 90.071.992.547.409,91');
});

test('formatador de percentual mantém a leitura brasileira da taxa sem conversão de precisão', () => {
  assert.equal(formatPercent(12.5), '12,5%');
  assert.equal(formatPercent('90071992547409.91'), '90.071.992.547.409,91%');
  assert.equal(formatPercent(null), 'Não definido');
});
