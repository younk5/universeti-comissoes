/* ===== LÓGICA PURA =====
   Estas funções não dependem do navegador para também poderem ser testadas no Node. */
const STORAGE_KEY = 'controle-comissoes.v1';

function normalizeMoney(value) {
  const text = String(value ?? '').trim().replace(/R\$|\s/g, '');
  if (!text) return Number.NaN;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function calculateCommission(saleValue, type, input) {
  const sale = Number(saleValue);
  const amount = Number(input);
  if (!Number.isFinite(sale) || !Number.isFinite(amount)) return Number.NaN;

  const result = type === 'percentage' ? sale * amount / 100 : amount;
  return Math.round((result + Number.EPSILON) * 100) / 100;
}

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

const CommissionLogic = {
  STORAGE_KEY,
  normalizeMoney,
  calculateCommission,
  todayLocal,
  formatCurrency,
};

if (typeof window !== 'undefined') window.CommissionLogic = CommissionLogic;
if (typeof module !== 'undefined' && module.exports) module.exports = CommissionLogic;
