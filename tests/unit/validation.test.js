import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIdentifier,
  parseMoney,
  parseMoneyToCents,
  parsePercentageToBasisPoints,
  validateCommissionInput,
  validatePassword,
} from '../../src/server/domain/validation.js';

test('normaliza nome de usuário sem alterar e-mail', () => {
  assert.equal(normalizeIdentifier('  Vendas.SP  '), 'vendas.sp');
  assert.equal(normalizeIdentifier(' ANA@EXEMPLO.COM '), 'ana@exemplo.com');
});

test('accepts passwords with the provider-enforced six character minimum', () => {
  assert.throws(() => validatePassword('12345'), /6 caracteres/);
  assert.equal(validatePassword('123456'), '123456');
});

test('aceita valor financeiro positivo com vírgula ou ponto', () => {
  assert.equal(parseMoney('12,50'), 12.5);
  assert.equal(parseMoney('12.50'), 12.5);
  assert.throws(() => parseMoney('0'), /valor positivo/);
  assert.throws(() => parseMoney('infinito'), /valor positivo/);
});

test('normaliza os campos obrigatórios de uma comissão', () => {
  assert.deepEqual(validateCommissionInput({
    sellerId: ' seller-1 ',
    product: ' Plano anual ',
    saleValue: '1.200,00',
    saleDate: '2026-09-07',
    note: ' cliente renovou ',
  }), {
    sellerId: 'seller-1',
    productId: null,
    product: 'Plano anual',
    saleValue: 1200,
    saleDate: '2026-09-07',
    note: 'cliente renovou',
  });
});

test('catalog commission input retains only the selected product identity for server authorization', () => {
  assert.deepEqual(validateCommissionInput({
    sellerId: ' seller-1 ',
    productId: ' 2e415a09-ef2f-4f4c-93e1-94409f6f5422 ',
    product: 'Texto do navegador',
    saleValue: '1.200,00',
    saleDate: '2026-09-07',
    note: ' cliente renovou ',
  }), {
    sellerId: 'seller-1',
    productId: '2e415a09-ef2f-4f4c-93e1-94409f6f5422',
    product: 'Texto do navegador',
    saleValue: 1200,
    saleDate: '2026-09-07',
    note: 'cliente renovou',
  });
});

test('catalog commission input rejects a malformed product id before any database lookup', () => {
  assert.throws(
    () => validateCommissionInput({
      sellerId: 'seller-1',
      productId: 'not-a-uuid',
      saleValue: '1.200,00',
      saleDate: '2026-09-07',
    }),
    /identificador de produto válido/i,
  );
});

test('parseMoneyToCents keeps Brazilian cents exactly', () => {
  assert.equal(parseMoneyToCents('1.234,56'), 123456);
  assert.equal(parseMoneyToCents(0.01), 1);
  assert.throws(() => parseMoneyToCents('0'), /maior que zero/i);
});

test('parseMoneyToCents rejects imprecise and out-of-range input', () => {
  assert.equal(parseMoneyToCents('9.000.000.000.000,00'), 900000000000000);
  assert.throws(() => parseMoneyToCents(0.001), /duas casas/i);
  assert.throws(() => parseMoneyToCents('9.000.000.000.000,01'), /máximo/i);
});

test('parsePercentageToBasisPoints keeps rate precision and bounds', () => {
  assert.equal(parsePercentageToBasisPoints('10,5'), 1050);
  assert.equal(parsePercentageToBasisPoints(100), 10000);
  assert.throws(() => parsePercentageToBasisPoints('10,555'), /duas casas/i);
  assert.throws(() => parsePercentageToBasisPoints('100,01'), /máximo/i);
});

test('validateCommissionInput rejects paid and voided commissions', () => {
  const input = {
    sellerId: 'seller-1',
    product: 'Plano anual',
    saleValue: '1.200,00',
    saleDate: '2026-09-08',
  };

  assert.throws(
    () => validateCommissionInput({ ...input, paymentStatus: 'paid' }),
    /pagas ou anuladas/i,
  );
  assert.throws(
    () => validateCommissionInput({ ...input, status: 'voided' }),
    /pagas ou anuladas/i,
  );
});
