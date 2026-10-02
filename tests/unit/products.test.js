import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductInput } from '../../src/server/domain/products.js';

test('validateProductInput trims a fixed product and converts Brazilian money to exact cents', () => {
  assert.deepEqual(validateProductInput({
    name: ' Cabo USB-C ', commissionType: 'fixed', commissionInput: '20,00',
  }), {
    name: 'Cabo USB-C',
    commissionType: 'fixed',
    commissionRateBps: null,
    commissionFixedCents: 2000,
  });
});

test('validateProductInput converts percentage input to exact basis points', () => {
  assert.deepEqual(validateProductInput({
    name: 'Plano anual', commissionType: 'percentage', commissionInput: '10,5',
  }), {
    name: 'Plano anual',
    commissionType: 'percentage',
    commissionRateBps: 1050,
    commissionFixedCents: null,
  });
});

test('validateProductInput rejects invalid names, rule types, and ambiguous rule payloads', () => {
  for (const input of [
    { name: ' ', commissionType: 'fixed', commissionInput: '20' },
    { name: 'x'.repeat(201), commissionType: 'fixed', commissionInput: '20' },
    { name: 'Plano', commissionType: 'other', commissionInput: '20' },
    { name: 'Plano', commissionType: 'fixed', commissionInput: '0' },
    { name: 'Plano', commissionType: 'percentage', commissionInput: '100,01' },
    { name: 'Plano', commissionType: 'fixed', commissionInput: '20', commissionRateBps: 1 },
    { name: 'Plano', commissionType: 'percentage', commissionInput: '10', commissionFixedCents: 1 },
  ]) {
    assert.throws(() => validateProductInput(input));
  }
});
