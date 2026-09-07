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

const { createEmptyState, sanitizeState, validateSeller, sellerHasCommissions, sellerHasMovements, removeSellerAndMovements } = require('../app.js');

test('normaliza estado corrompido em coleções vazias', () => {
  assert.deepEqual(sanitizeState({ sellers: 'erro', commissions: null }), createEmptyState());
});

test('mantém retiradas vazias ao abrir dados salvos antigos', () => {
  assert.deepEqual(sanitizeState({ sellers: [], commissions: [] }), {
    sellers: [],
    commissions: [],
    withdrawals: [],
  });
});

test('exige nome para cadastrar vendedor', () => {
  assert.deepEqual(validateSeller({ name: '   ' }), {
    valid: false,
    error: 'Informe o nome do vendedor.',
  });
  assert.deepEqual(validateSeller({ name: ' Ana ', contact: 'ana@empresa.com' }), {
    valid: true,
    value: { name: 'Ana' },
  });
});

test('identifica vendedor com comissões vinculadas', () => {
  assert.equal(sellerHasCommissions({ commissions: [{ sellerId: 'v1' }] }, 'v1'), true);
  assert.equal(sellerHasCommissions({ commissions: [{ sellerId: 'v1' }] }, 'v2'), false);
});

test('protege vendedor que tenha retiradas na carteira', () => {
  assert.equal(sellerHasMovements({ commissions: [], withdrawals: [{ sellerId: 'v1' }] }, 'v1'), true);
  assert.equal(sellerHasMovements({ commissions: [], withdrawals: [{ sellerId: 'v1' }] }, 'v2'), false);
});

const { validateCommission, createCommission } = require('../app.js');
const commissionSellers = [{ id: 'v1', name: 'Ana' }];

test('permite excluir vendedor junto com as movimentações da carteira após confirmação', () => {
  const state = {
    sellers: [{ id: 'ana', name: 'Ana' }, { id: 'bruno', name: 'Bruno' }],
    commissions: [{ id: 'c1', sellerId: 'ana' }, { id: 'c2', sellerId: 'bruno' }],
    withdrawals: [{ id: 'r1', sellerId: 'ana' }],
  };

  assert.deepEqual(removeSellerAndMovements(state, 'ana'), {
    sellers: [{ id: 'bruno', name: 'Bruno' }],
    commissions: [{ id: 'c2', sellerId: 'bruno' }],
    withdrawals: [],
  });
  assert.equal(state.sellers.length, 2);
});

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

const { calculateBalance } = require('../app.js');
const { validateWithdrawal } = require('../app.js');
const { createWithdrawal } = require('../app.js');
const { summarizeSellerWallet } = require('../app.js');
const { hasNonNegativeWalletBalance } = require('../app.js');
const { buildWalletMovements } = require('../app.js');

test('calcula o saldo disponível após retirar dinheiro', () => {
  assert.deepEqual(calculateBalance([
    { commissionValue: 120 },
    { commissionValue: 80 },
  ], [
    { value: 75 },
    { value: 25 },
  ]), {
    commissionTotal: 200,
    withdrawalTotal: 100,
    balance: 100,
  });
});

test('calcula a carteira de cada vendedor sem misturar movimentações', () => {
  assert.deepEqual(summarizeSellerWallet('ana', [
    { sellerId: 'ana', commissionValue: 120 },
    { sellerId: 'bruno', commissionValue: 80 },
    { sellerId: 'ana', commissionValue: 30 },
  ], [
    { sellerId: 'ana', value: 50 },
    { sellerId: 'bruno', value: 10 },
  ]), {
    commissionTotal: 150,
    withdrawalTotal: 50,
    balance: 100,
  });
});

test('impede alteração de comissão que deixe uma carteira negativa', () => {
  assert.equal(hasNonNegativeWalletBalance('ana', [
    { sellerId: 'ana', commissionValue: 40 },
  ], [
    { sellerId: 'ana', value: 50 },
  ]), false);
});

test('cria histórico cronológico de créditos e retiradas da carteira', () => {
  assert.deepEqual(buildWalletMovements('ana', [
    { id: 'c1', sellerId: 'ana', product: 'Película', commissionValue: 40, saleDate: '2026-09-02', createdAt: '2026-09-02T10:00:00.000Z' },
    { id: 'c2', sellerId: 'bruno', product: 'Cabo', commissionValue: 20, saleDate: '2026-09-03', createdAt: '2026-09-03T10:00:00.000Z' },
  ], [
    { id: 'r1', sellerId: 'ana', value: 15, withdrawalDate: '2026-09-03', note: 'Pagamento', createdAt: '2026-09-03T11:00:00.000Z' },
  ]), [
    { id: 'r1', type: 'withdrawal', date: '2026-09-03', value: 15, description: 'Pagamento', createdAt: '2026-09-03T11:00:00.000Z' },
    { id: 'c1', type: 'commission', date: '2026-09-02', value: 40, description: 'Película', createdAt: '2026-09-02T10:00:00.000Z' },
  ]);
});

test('impede retirada maior que o saldo disponível', () => {
  assert.deepEqual(validateWithdrawal({ sellerId: 'ana', value: '150,00', withdrawalDate: '2026-09-07', note: '' }, [{ id: 'ana', name: 'Ana' }], 100), {
    valid: false,
    error: 'A retirada não pode ser maior que o saldo disponível.',
  });
});

test('cria retirada com vendedor, valor, data e observação', () => {
  const withdrawal = createWithdrawal({
    sellerId: 'ana', value: '75,50', withdrawalDate: '2026-09-07', note: 'Retirada do caixa',
  }, [{ id: 'ana', name: 'Ana' }], 100, '2026-09-07T12:00:00.000Z');
  assert.equal(withdrawal.sellerId, 'ana');
  assert.equal(withdrawal.sellerName, 'Ana');
  assert.equal(withdrawal.value, 75.5);
  assert.equal(withdrawal.withdrawalDate, '2026-09-07');
  assert.equal(withdrawal.note, 'Retirada do caixa');
  assert.equal(withdrawal.createdAt, '2026-09-07T12:00:00.000Z');
});

test('gera CSV com BOM, ponto e vírgula e campos escapados', () => {
  const csv = buildCommissionCsv([{
    sellerName: 'Ana', product: 'Plano; Premium', saleValue: 1200,
    commissionValue: 120, saleDate: '2026-09-07', note: 'Disse "ok"',
  }]);
  assert.ok(csv.startsWith('\uFEFFVendedor;Produto ou serviço;Valor da venda;Valor da comissão;Data;Observação'));
  assert.match(csv, /"Plano; Premium"/);
  assert.match(csv, /"Disse ""ok"""/);
});
