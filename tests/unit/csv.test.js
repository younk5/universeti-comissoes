import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv } from '../../src/server/domain/csv.js';

test('gera CSV com BOM, cabeçalhos administrativos e aspas escapadas', () => {
  const csv = buildCsv([{
    sellerName: 'Ana',
    product: 'Plano "Premium"',
    saleValue: '1200.00',
    commissionValue: '120.00',
    saleDate: '2026-09-07',
    paymentStatus: 'pending',
    note: 'Disse "ok"',
  }]);

  assert.equal(
    csv,
    '\uFEFFVendedor,Produto,Valor da venda,Comissão,Data,Status,Observação\r\nAna,"Plano ""Premium""",1200.00,120.00,2026-09-07,pending,"Disse ""ok"""\r\n',
  );
});

test('CSV preserves exact authorized monetary strings without Number conversion', () => {
  const csv = buildCsv([{
    sellerName: 'Ana',
    product: 'Contrato enterprise',
    saleValue: '8999999999999.99',
    commissionValue: '98999999999999.89',
    saleDate: '2026-09-08',
    paymentStatus: 'paid',
    note: '',
  }]);

  assert.match(csv, /Ana,Contrato enterprise,8999999999999\.99,98999999999999\.89,2026-09-08,paid,/);
});

test('CSV neutraliza fórmulas digitadas nos campos de texto', () => {
  const csv = buildCsv([{
    sellerName: 'Ana',
    product: '=1+1',
    saleValue: '10.00',
    commissionValue: '1.00',
    saleDate: '2026-09-08',
    paymentStatus: 'pending',
    note: '@SUM(A1:A9)',
  }]);

  assert.match(csv, /Ana,'=1\+1,10\.00,1\.00,2026-09-08,pending,'@SUM\(A1:A9\)/);
  assert.doesNotMatch(csv, /,=1\+1,/);
});
