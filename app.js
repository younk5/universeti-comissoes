/* ===== LÓGICA PURA =====
   Estas funções não dependem do navegador para também poderem ser testadas no Node. */
const STORAGE_KEY = 'controle-comissoes.v1';

function normalizeMoney(value) {
  const text = String(value ?? '').trim().replace(/R\$|\s/g, '');
  if (!text) return Number.NaN;

  let normalized;
  if (text.includes(',')) {
    // Formato brasileiro completo: "1.234,56"
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // Só pontos, em grupos de três: "1.500" e "1.234.567" são milhares
    normalized = text.replace(/\./g, '');
  } else {
    // Decimal com ponto (padrão internacional): "1234.56"
    normalized = text;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toSafeNumber(value, fallback = 0) {
  const parsed = typeof value === 'string' ? normalizeMoney(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createEmptyState() {
  return { sellers: [], commissions: [], withdrawals: [] };
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyState();

  const sellers = Array.isArray(raw.sellers)
    ? raw.sellers
        .filter((seller) => seller && typeof seller === 'object' && seller.id && String(seller.name ?? '').trim())
        .map((seller) => ({
          id: String(seller.id),
          name: String(seller.name).trim(),
          createdAt: seller.createdAt || '',
        }))
    : [];

  const commissions = Array.isArray(raw.commissions)
    ? raw.commissions
        .filter((item) => item && typeof item === 'object' && item.id && item.sellerId)
        .map((item) => ({
          id: String(item.id),
          sellerId: String(item.sellerId),
          sellerName: String(item.sellerName ?? ''),
          product: String(item.product ?? ''),
          saleValue: toSafeNumber(item.saleValue),
          commissionType: item.commissionType === 'fixed' ? 'fixed' : 'percentage',
          commissionInput: toSafeNumber(item.commissionInput),
          commissionValue: toSafeNumber(item.commissionValue),
          saleDate: typeof item.saleDate === 'string' ? item.saleDate : '',
          note: String(item.note ?? ''),
          createdAt: item.createdAt || '',
          updatedAt: item.updatedAt || item.createdAt || '',
        }))
    : [];

  const withdrawals = Array.isArray(raw.withdrawals)
    ? raw.withdrawals
        .filter((item) => item && typeof item === 'object' && item.id && item.sellerId)
        .map((item) => ({
          id: String(item.id),
          sellerId: String(item.sellerId),
          sellerName: String(item.sellerName ?? ''),
          value: toSafeNumber(item.value),
          withdrawalDate: typeof item.withdrawalDate === 'string' ? item.withdrawalDate : '',
          note: String(item.note ?? ''),
          createdAt: item.createdAt || '',
        }))
    : [];

  return { sellers, commissions, withdrawals };
}

function loadState(storage) {
  try {
    return sanitizeState(JSON.parse(storage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return createEmptyState();
  }
}

function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function validateSeller({ name, contact }) {
  if (!String(name || '').trim()) {
    return { valid: false, error: 'Informe o nome do vendedor.' };
  }
  return {
    valid: true,
    value: {
      name: String(name).trim(),
    },
  };
}

function sellerHasCommissions(state, sellerId) {
  return state.commissions.some((commission) => commission.sellerId === sellerId);
}

function sellerHasMovements(state, sellerId) {
  return sellerHasCommissions(state, sellerId)
    || (state.withdrawals || []).some((withdrawal) => withdrawal.sellerId === sellerId);
}

function removeSellerAndMovements(state, sellerId) {
  return {
    ...state,
    sellers: state.sellers.filter((seller) => seller.id !== sellerId),
    commissions: state.commissions.filter((commission) => commission.sellerId !== sellerId),
    withdrawals: (state.withdrawals || []).filter((withdrawal) => withdrawal.sellerId !== sellerId),
  };
}

function validateCommission(input, sellers) {
  const seller = sellers.find((item) => item.id === input.sellerId);
  if (!seller) return { valid: false, error: 'Selecione um vendedor.' };

  const saleValue = normalizeMoney(input.saleValue);
  if (!(saleValue > 0)) {
    return { valid: false, error: 'Informe um valor de venda maior que zero.' };
  }

  if (!['percentage', 'fixed'].includes(input.commissionType)) {
    return { valid: false, error: 'Selecione um tipo de comissão válido.' };
  }

  const commissionInput = normalizeMoney(input.commissionInput);
  if (!(commissionInput > 0)) {
    return { valid: false, error: 'Informe uma comissão maior que zero.' };
  }

  if (!input.saleDate) {
    return { valid: false, error: 'Informe a data da venda.' };
  }

  return { valid: true, value: { seller, saleValue, commissionInput } };
}

function createCommission(input, sellers, now = new Date().toISOString()) {
  const validation = validateCommission(input, sellers);
  if (!validation.valid) return null;

  const { seller, saleValue, commissionInput } = validation.value;
  const commissionValue = calculateCommission(saleValue, input.commissionType, commissionInput);
  return {
    id: createId(),
    sellerId: seller.id,
    sellerName: seller.name,
    product: String(input.product || '').trim(),
    saleValue,
    commissionType: input.commissionType,
    commissionInput,
    commissionValue,
    saleDate: input.saleDate,
    note: String(input.note || '').trim(),
    createdAt: now,
    updatedAt: now,
  };
}

function filterCommissions(commissions, { sellerId = '', startDate = '', endDate = '' } = {}) {
  return commissions.filter((item) => (
    (!sellerId || item.sellerId === sellerId)
    && (!startDate || item.saleDate >= startDate)
    && (!endDate || item.saleDate <= endDate)
  ));
}

function filterWithdrawals(withdrawals, { sellerId = '', startDate = '', endDate = '' } = {}) {
  return (withdrawals || []).filter((item) => (
    (!sellerId || item.sellerId === sellerId)
    && (!startDate || item.withdrawalDate >= startDate)
    && (!endDate || item.withdrawalDate <= endDate)
  ));
}

function sortCommissions(commissions, field = 'saleDate', direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...commissions].sort((left, right) => {
    const leftValue = left[field] ?? '';
    const rightValue = right[field] ?? '';
    let comparison;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      comparison = leftValue - rightValue;
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue), 'pt-BR', { numeric: true });
    }
    return comparison * multiplier;
  });
}

function summarizeCommissions(commissions) {
  const totals = new Map();
  for (const item of commissions) {
    const previous = totals.get(item.sellerId);
    totals.set(item.sellerId, {
      sellerId: item.sellerId,
      sellerName: item.sellerName,
      total: (previous?.total || 0) + item.commissionValue,
    });
  }

  const bySeller = [...totals.values()]
    .map((item) => ({ ...item, total: Math.round((item.total + Number.EPSILON) * 100) / 100 }))
    .sort((left, right) => right.total - left.total || left.sellerName.localeCompare(right.sellerName, 'pt-BR'));
  const total = Math.round((commissions.reduce((sum, item) => sum + item.commissionValue, 0) + Number.EPSILON) * 100) / 100;

  return { total, count: commissions.length, bySeller };
}

function calculateBalance(commissions, withdrawals = []) {
  const commissionTotal = Math.round((commissions.reduce((sum, item) => sum + (Number(item.commissionValue) || 0), 0) + Number.EPSILON) * 100) / 100;
  const withdrawalTotal = Math.round((withdrawals.reduce((sum, item) => sum + (Number(item.value) || 0), 0) + Number.EPSILON) * 100) / 100;
  return {
    commissionTotal,
    withdrawalTotal,
    balance: Math.round((commissionTotal - withdrawalTotal + Number.EPSILON) * 100) / 100,
  };
}

function summarizeSellerWallet(sellerId, commissions, withdrawals = []) {
  return calculateBalance(
    commissions.filter((commission) => commission.sellerId === sellerId),
    withdrawals.filter((withdrawal) => withdrawal.sellerId === sellerId),
  );
}

function hasNonNegativeWalletBalance(sellerId, commissions, withdrawals = []) {
  return summarizeSellerWallet(sellerId, commissions, withdrawals).balance >= 0;
}

function buildWalletMovements(sellerId, commissions, withdrawals = []) {
  const commissionMovements = commissions
    .filter((commission) => commission.sellerId === sellerId)
    .map((commission) => ({
      id: commission.id,
      type: 'commission',
      date: commission.saleDate,
      value: commission.commissionValue,
      description: commission.product || 'Comissão de venda',
      createdAt: commission.createdAt || '',
    }));
  const withdrawalMovements = withdrawals
    .filter((withdrawal) => withdrawal.sellerId === sellerId)
    .map((withdrawal) => ({
      id: withdrawal.id,
      type: 'withdrawal',
      date: withdrawal.withdrawalDate,
      value: withdrawal.value,
      description: withdrawal.note || 'Retirada',
      createdAt: withdrawal.createdAt || '',
    }));
  return [...commissionMovements, ...withdrawalMovements].sort((left, right) => (
    String(right.date).localeCompare(String(left.date))
    || String(right.createdAt).localeCompare(String(left.createdAt))
  ));
}

function validateWithdrawal(input, sellers, availableBalance) {
  const seller = sellers.find((item) => item.id === input.sellerId);
  if (!seller) {
    return { valid: false, error: 'Selecione o vendedor que receberá a retirada.' };
  }
  const value = normalizeMoney(input.value);
  if (!(value > 0)) {
    return { valid: false, error: 'Informe um valor de retirada maior que zero.' };
  }
  if (!input.withdrawalDate) {
    return { valid: false, error: 'Informe a data da retirada.' };
  }
  if (value > availableBalance) {
    return { valid: false, error: 'A retirada não pode ser maior que o saldo disponível.' };
  }
  return {
    valid: true,
    value: {
      sellerId: seller.id,
      sellerName: seller.name,
      value,
      withdrawalDate: input.withdrawalDate,
      note: String(input.note || '').trim(),
    },
  };
}

function createWithdrawal(input, sellers, availableBalance, now = new Date().toISOString()) {
  const validation = validateWithdrawal(input, sellers, availableBalance);
  if (!validation.valid) return null;
  return {
    id: createId(),
    ...validation.value,
    createdAt: now,
  };
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCommissionCsv(commissions) {
  const header = ['Vendedor', 'Produto ou serviço', 'Valor da venda', 'Valor da comissão', 'Data', 'Observação'];
  const rows = commissions.map((item) => [
    item.sellerName,
    item.product,
    formatCurrency(item.saleValue),
    formatCurrency(item.commissionValue),
    item.saleDate,
    item.note,
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`;
}

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Fechamento do período: comissões, retiradas e saldo por vendedor. */
function buildClosing(commissions, withdrawals, { startDate = '', endDate = '' } = {}) {
  const periodo = { startDate, endDate };
  const linhas = new Map();
  const obter = (item) => {
    if (!linhas.has(item.sellerId)) {
      linhas.set(item.sellerId, {
        sellerId: item.sellerId,
        sellerName: item.sellerName || 'Vendedor não encontrado',
        commissionTotal: 0,
        commissionCount: 0,
        withdrawalTotal: 0,
        withdrawalCount: 0,
      });
    }
    const linha = linhas.get(item.sellerId);
    if (item.sellerName) linha.sellerName = item.sellerName;
    return linha;
  };

  for (const item of filterCommissions(commissions, periodo)) {
    const linha = obter(item);
    linha.commissionTotal += item.commissionValue;
    linha.commissionCount += 1;
  }
  for (const item of filterWithdrawals(withdrawals, periodo)) {
    const linha = obter(item);
    linha.withdrawalTotal += item.value;
    linha.withdrawalCount += 1;
  }

  const rows = [...linhas.values()]
    .map((linha) => ({
      ...linha,
      commissionTotal: round2(linha.commissionTotal),
      withdrawalTotal: round2(linha.withdrawalTotal),
      balance: round2(linha.commissionTotal - linha.withdrawalTotal),
    }))
    .sort((a, b) => b.commissionTotal - a.commissionTotal || a.sellerName.localeCompare(b.sellerName, 'pt-BR'));

  const totals = rows.reduce(
    (acc, linha) => ({
      commissionTotal: round2(acc.commissionTotal + linha.commissionTotal),
      withdrawalTotal: round2(acc.withdrawalTotal + linha.withdrawalTotal),
      balance: round2(acc.balance + linha.balance),
      commissionCount: acc.commissionCount + linha.commissionCount,
      withdrawalCount: acc.withdrawalCount + linha.withdrawalCount,
    }),
    { commissionTotal: 0, withdrawalTotal: 0, balance: 0, commissionCount: 0, withdrawalCount: 0 },
  );

  return { rows, totals };
}

function buildClosingCsv(closing, { startDate = '', endDate = '' } = {}) {
  const header = ['Vendedor', 'Comissões no período', 'Qtd. comissões', 'Retiradas no período', 'Qtd. retiradas', 'Saldo do período'];
  const rows = closing.rows.map((linha) => [
    linha.sellerName,
    formatCurrency(linha.commissionTotal),
    linha.commissionCount,
    formatCurrency(linha.withdrawalTotal),
    linha.withdrawalCount,
    formatCurrency(linha.balance),
  ]);
  rows.push([
    'TOTAL',
    formatCurrency(closing.totals.commissionTotal),
    closing.totals.commissionCount,
    formatCurrency(closing.totals.withdrawalTotal),
    closing.totals.withdrawalCount,
    formatCurrency(closing.totals.balance),
  ]);
  const periodo = startDate || endDate ? `Período;${startDate || 'início'};${endDate || 'hoje'}` : 'Período;todos';
  return `\uFEFF${periodo}\r\n${[header, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`;
}

/** Backup completo em JSON (diferente do CSV: pode ser importado de volta). */
function buildBackup(state, now = new Date().toISOString()) {
  return {
    app: 'controle-comissoes',
    version: 1,
    exportedAt: now,
    sellers: state.sellers,
    commissions: state.commissions,
    withdrawals: state.withdrawals || [],
  };
}

/** Lê um backup exportado; devolve o estado saneado ou null se o arquivo for inválido. */
function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(String(text ?? ''));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const pareceBackup = raw.app === 'controle-comissoes'
    || Array.isArray(raw.sellers)
    || Array.isArray(raw.commissions)
    || Array.isArray(raw.withdrawals);
  if (!pareceBackup) return null;
  return sanitizeState(raw);
}


const CommissionLogic = {
  STORAGE_KEY,
  normalizeMoney,
  calculateCommission,
  todayLocal,
  formatCurrency,
  createId,
  createEmptyState,
  sanitizeState,
  loadState,
  saveState,
  validateSeller,
  sellerHasCommissions,
  sellerHasMovements,
  removeSellerAndMovements,
  validateCommission,
  createCommission,
  filterCommissions,
  filterWithdrawals,
  sortCommissions,
  summarizeCommissions,
  calculateBalance,
  summarizeSellerWallet,
  hasNonNegativeWalletBalance,
  buildWalletMovements,
  validateWithdrawal,
  createWithdrawal,
  buildCommissionCsv,
  buildClosing,
  buildClosingCsv,
  buildBackup,
  parseBackup,
};

if (typeof window !== 'undefined') window.CommissionLogic = CommissionLogic;
if (typeof module !== 'undefined' && module.exports) module.exports = CommissionLogic;

/* ===== APLICAÇÃO NO NAVEGADOR ===== */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const dom = {
      message: document.querySelector('#app-message'),
      sellerForm: document.querySelector('#seller-form'),
      sellerName: document.querySelector('#seller-name'),
      sellerError: document.querySelector('#seller-error'),
      sellerSubmit: document.querySelector('#seller-submit'),
      sellerCancel: document.querySelector('#seller-cancel'),
      sellerList: document.querySelector('#seller-list'),
      commissionForm: document.querySelector('#commission-form'),
      commissionFields: document.querySelector('#commission-fields'),
      commissionSeller: document.querySelector('#commission-seller'),
      commissionProduct: document.querySelector('#commission-product'),
      commissionSaleValue: document.querySelector('#commission-sale-value'),
      commissionType: document.querySelector('#commission-type'),
      commissionInput: document.querySelector('#commission-input'),
      commissionInputLabel: document.querySelector('#commission-input-label'),
      commissionDate: document.querySelector('#commission-date'),
      commissionNote: document.querySelector('#commission-note'),
      commissionError: document.querySelector('#commission-error'),
      commissionPreview: document.querySelector('#commission-preview'),
      commissionSubmit: document.querySelector('#commission-submit'),
      commissionCancel: document.querySelector('#commission-cancel'),
      commissionEmpty: document.querySelector('#commission-empty'),
      withdrawalForm: document.querySelector('#withdrawal-form'),
      withdrawalSeller: document.querySelector('#withdrawal-seller'),
      withdrawalValue: document.querySelector('#withdrawal-value'),
      withdrawalDate: document.querySelector('#withdrawal-date'),
      withdrawalNote: document.querySelector('#withdrawal-note'),
      withdrawalError: document.querySelector('#withdrawal-error'),
      withdrawalPreview: document.querySelector('#withdrawal-preview'),
      walletList: document.querySelector('#wallet-list'),
      walletHistoryTitle: document.querySelector('#wallet-history-title'),
      walletMovements: document.querySelector('#wallet-movement-list'),
      filterSeller: document.querySelector('#filter-seller'),
      filterStartDate: document.querySelector('#filter-start-date'),
      filterEndDate: document.querySelector('#filter-end-date'),
      filterError: document.querySelector('#filter-error'),
      filterClear: document.querySelector('#filter-clear'),
      exportCsv: document.querySelector('#export-csv'),
      exportJson: document.querySelector('#export-json'),
      importJson: document.querySelector('#import-json'),
      importFile: document.querySelector('#import-file'),
      closingStart: document.querySelector('#closing-start'),
      closingEnd: document.querySelector('#closing-end'),
      closingBody: document.querySelector('#closing-body'),
      closingStatus: document.querySelector('#closing-status'),
      closingExport: document.querySelector('#closing-export'),
      summaryBalance: document.querySelector('#summary-balance'),
      summaryTotal: document.querySelector('#summary-total'),
      summaryWithdrawals: document.querySelector('#summary-withdrawals'),
      summaryCount: document.querySelector('#summary-count'),
      summarySellers: document.querySelector('#summary-sellers'),
      chart: document.querySelector('#commission-chart'),
      historyStatus: document.querySelector('#history-status'),
      tableBody: document.querySelector('#commission-table-body'),
      sortButtons: document.querySelectorAll('.sort-button'),
    };

    let state = loadState(window.localStorage);
    let editingSellerId = null;
    let editingCommissionId = null;
    let activeWalletSellerId = null;
    let sortState = { field: 'saleDate', direction: 'desc' };

    function showMessage(text, type = 'info') {
      dom.message.textContent = text;
      dom.message.className = `app-message ${type}`;
      dom.message.hidden = false;
    }

    /** Diálogo de confirmação próprio (acessível, com foco preso e Esc para cancelar). */
    function confirmar({ titulo = 'Confirmar', mensagem, textoConfirmar = 'Confirmar', perigoso = false }) {
      return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'app-dialog';

        const heading = document.createElement('h2');
        heading.textContent = titulo;
        const texto = document.createElement('p');
        texto.textContent = mensagem;

        const acoes = document.createElement('div');
        acoes.className = 'app-dialog-actions';
        const cancelar = document.createElement('button');
        cancelar.type = 'button';
        cancelar.className = 'button button-secondary';
        cancelar.textContent = 'Cancelar';
        const confirmarBotao = document.createElement('button');
        confirmarBotao.type = 'button';
        confirmarBotao.className = `button${perigoso ? ' button-danger' : ''}`;
        confirmarBotao.textContent = textoConfirmar;
        acoes.append(cancelar, confirmarBotao);

        dialog.append(heading, texto, acoes);
        dialog.setAttribute('aria-label', titulo);
        dialog.addEventListener('cancel', (evento) => {
          evento.preventDefault();
          dialog.close('false');
        });
        dialog.addEventListener('close', () => {
          const resposta = dialog.returnValue === 'true';
          dialog.remove();
          resolve(resposta);
        });
        cancelar.addEventListener('click', () => dialog.close('false'));
        confirmarBotao.addEventListener('click', () => dialog.close('true'));

        document.body.append(dialog);
        dialog.showModal();
        confirmarBotao.focus();
      });
    }

    function showSellerError(text = '') {
      dom.sellerError.textContent = text;
      dom.sellerError.hidden = !text;
    }

    function showCommissionError(text = '') {
      dom.commissionError.textContent = text;
      dom.commissionError.hidden = !text;
    }

    function showWithdrawalError(text = '') {
      dom.withdrawalError.textContent = text;
      dom.withdrawalError.hidden = !text;
    }

    function showFilterError(text = '') {
      dom.filterError.textContent = text;
      dom.filterError.hidden = !text;
    }

    const CAMPOS_DE_ENTRADA = () => [
      dom.sellerName,
      dom.commissionSeller,
      dom.commissionSaleValue,
      dom.commissionType,
      dom.commissionInput,
      dom.commissionDate,
      dom.withdrawalSeller,
      dom.withdrawalValue,
      dom.withdrawalDate,
    ];

    function limparInvalidos() {
      for (const campo of CAMPOS_DE_ENTRADA()) campo.removeAttribute('aria-invalid');
    }

    /** Marca o campo inválido e leva o foco até ele. */
    function focarErro(mensagem, mapa, padrao) {
      limparInvalidos();
      const alvo = mapa.find(([padrao]) => padrao.test(mensagem))?.[1] ?? padrao;
      if (!alvo) return;
      alvo.setAttribute('aria-invalid', 'true');
      alvo.focus?.();
    }

    function persistState() {
      try {
        saveState(window.localStorage, state);
        return true;
      } catch {
        showMessage('Não foi possível salvar os dados neste navegador.', 'error');
        return false;
      }
    }

    function resetSellerForm() {
      editingSellerId = null;
      dom.sellerForm.reset();
      dom.sellerSubmit.textContent = 'Cadastrar vendedor';
      dom.sellerCancel.hidden = true;
      showSellerError();
      limparInvalidos();
    }

    function createButton(text, className, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = text;
      button.addEventListener('click', onClick);
      return button;
    }

    function renderSellers() {
      dom.sellerList.replaceChildren();

      if (!state.sellers.length) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.textContent = 'Nenhum vendedor cadastrado.';
        dom.sellerList.append(empty);
        return;
      }

      const sellers = [...state.sellers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      for (const seller of sellers) {
        const item = document.createElement('li');
        item.className = 'seller-item';

        const details = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = seller.name;
        details.append(name);

        const actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.append(
          createButton('Editar vendedor', 'button button-secondary', () => {
            editingSellerId = seller.id;
            dom.sellerName.value = seller.name;
            dom.sellerSubmit.textContent = 'Salvar alterações';
            dom.sellerCancel.hidden = false;
            showSellerError();
            dom.sellerName.focus();
          }),
          createButton('Excluir vendedor', 'button button-danger', async () => {
            const commissionCount = state.commissions.filter((commission) => commission.sellerId === seller.id).length;
            const withdrawalCount = state.withdrawals.filter((withdrawal) => withdrawal.sellerId === seller.id).length;
            const linkedRecords = [
              commissionCount && `${commissionCount} ${commissionCount === 1 ? 'comissão' : 'comissões'}`,
              withdrawalCount && `${withdrawalCount} ${withdrawalCount === 1 ? 'retirada' : 'retiradas'}`,
            ].filter(Boolean).join(' e ');
            const confirmation = linkedRecords
              ? `Excluir ${seller.name} e ${linkedRecords}? Todo o histórico da carteira será apagado.`
              : `Excluir o vendedor ${seller.name}?`;

            if (!(await confirmar({
              titulo: 'Excluir vendedor',
              mensagem: confirmation,
              textoConfirmar: 'Excluir',
              perigoso: true,
            }))) return;
            const nextState = removeSellerAndMovements(state, seller.id);
            state.sellers = nextState.sellers;
            state.commissions = nextState.commissions;
            state.withdrawals = nextState.withdrawals;
            if (!persistState()) return;
            if (editingSellerId === seller.id) resetSellerForm();
            renderAll();
            showMessage(linkedRecords ? 'Vendedor e movimentações excluídos.' : 'Vendedor excluído.', 'success');
          }),
        );

        item.append(details, actions);
        dom.sellerList.append(item);
      }
    }

    function updateCommissionInputLabel() {
      const isPercentage = dom.commissionType.value === 'percentage';
      dom.commissionInputLabel.replaceChildren(`${isPercentage ? 'Percentual' : 'Valor fixo'} *`);
      dom.commissionInput.placeholder = isPercentage ? 'Ex.: 10' : 'Ex.: 150,00';
    }

    function getCommissionInput() {
      return {
        sellerId: dom.commissionSeller.value,
        product: dom.commissionProduct.value,
        saleValue: dom.commissionSaleValue.value,
        commissionType: dom.commissionType.value,
        commissionInput: dom.commissionInput.value,
        saleDate: dom.commissionDate.value,
        note: dom.commissionNote.value,
      };
    }

    function updateCommissionPreview() {
      const saleValue = normalizeMoney(dom.commissionSaleValue.value);
      const commissionInput = normalizeMoney(dom.commissionInput.value);
      const commissionValue = calculateCommission(saleValue, dom.commissionType.value, commissionInput);
      if (!(saleValue > 0) || !(commissionInput > 0) || !Number.isFinite(commissionValue)) {
        dom.commissionPreview.textContent = 'Informe os valores para calcular a comissão.';
        return;
      }
      dom.commissionPreview.textContent = `Comissão calculada: ${formatCurrency(commissionValue)}.`;
    }

    function resetCommissionForm() {
      editingCommissionId = null;
      dom.commissionForm.reset();
      dom.commissionType.value = 'percentage';
      dom.commissionDate.value = todayLocal();
      dom.commissionSubmit.textContent = 'Salvar comissão';
      dom.commissionCancel.hidden = true;
      showCommissionError();
      limparInvalidos();
      updateCommissionInputLabel();
      updateCommissionPreview();
    }

    function getActiveWalletSeller() {
      return state.sellers.find((seller) => seller.id === activeWalletSellerId) || null;
    }

    function getAvailableBalance(sellerId = activeWalletSellerId) {
      if (!sellerId) return 0;
      return summarizeSellerWallet(sellerId, state.commissions, state.withdrawals).balance;
    }

    function getWithdrawalInput() {
      return {
        sellerId: dom.withdrawalSeller.value,
        value: dom.withdrawalValue.value,
        withdrawalDate: dom.withdrawalDate.value,
        note: dom.withdrawalNote.value,
      };
    }

    function updateWithdrawalPreview() {
      const seller = getActiveWalletSeller();
      if (!seller) {
        dom.withdrawalPreview.textContent = 'Cadastre um vendedor para registrar uma retirada.';
        return;
      }
      const availableBalance = getAvailableBalance(seller.id);
      const value = normalizeMoney(dom.withdrawalValue.value);
      if (!(value > 0)) {
        dom.withdrawalPreview.textContent = `Saldo disponível de ${seller.name}: ${formatCurrency(availableBalance)}.`;
        return;
      }
      if (value > availableBalance) {
        dom.withdrawalPreview.textContent = `Saldo disponível de ${seller.name}: ${formatCurrency(availableBalance)}. A retirada não pode ser maior que esse valor.`;
        return;
      }
      dom.withdrawalPreview.textContent = `Saldo de ${seller.name} após a retirada: ${formatCurrency(availableBalance - value)}.`;
    }

    function resetWithdrawalForm() {
      dom.withdrawalForm.reset();
      dom.withdrawalDate.value = todayLocal();
      showWithdrawalError();
      limparInvalidos();
      updateWithdrawalPreview();
    }

    function selectWallet(sellerId) {
      activeWalletSellerId = state.sellers.some((seller) => seller.id === sellerId) ? sellerId : null;
      dom.withdrawalSeller.value = activeWalletSellerId || '';
      renderWallets();
      renderWalletMovements();
      updateWithdrawalPreview();
    }

    function renderWithdrawalSellerOptions() {
      const selectedSellerId = activeWalletSellerId || dom.withdrawalSeller.value;
      dom.withdrawalSeller.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Selecione um vendedor';
      dom.withdrawalSeller.append(placeholder);
      const sellers = [...state.sellers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      for (const seller of sellers) {
        const option = document.createElement('option');
        option.value = seller.id;
        option.textContent = seller.name;
        dom.withdrawalSeller.append(option);
      }
      activeWalletSellerId = sellers.some((seller) => seller.id === selectedSellerId)
        ? selectedSellerId
        : sellers[0]?.id || null;
      dom.withdrawalSeller.value = activeWalletSellerId || '';
    }

    async function deleteWithdrawal(record) {
      if (!(await confirmar({
        titulo: 'Excluir retirada',
        mensagem: 'Excluir esta retirada? O valor voltará à carteira do vendedor.',
        textoConfirmar: 'Excluir',
        perigoso: true,
      }))) return;
      state.withdrawals = state.withdrawals.filter((withdrawal) => withdrawal.id !== record.id);
      if (!persistState()) return;
      renderAll();
      showMessage('Retirada excluída. A carteira foi atualizada.', 'success');
    }

    function renderWallets() {
      dom.walletList.replaceChildren();
      const sellers = [...state.sellers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      if (!sellers.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Nenhuma carteira disponível. Cadastre um vendedor primeiro.';
        dom.walletList.append(empty);
        return;
      }

      for (const seller of sellers) {
        const wallet = summarizeSellerWallet(seller.id, state.commissions, state.withdrawals);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'wallet-card';
        card.setAttribute('aria-pressed', String(seller.id === activeWalletSellerId));
        const header = document.createElement('span');
        header.className = 'wallet-card-head';
        const name = document.createElement('strong');
        name.textContent = seller.name;
        const status = document.createElement('span');
        status.textContent = seller.id === activeWalletSellerId ? 'Carteira aberta' : 'Ver carteira';
        header.append(name, status);
        const balance = document.createElement('span');
        balance.className = 'wallet-card-balance';
        balance.textContent = formatCurrency(wallet.balance);
        const meta = document.createElement('span');
        meta.className = 'wallet-card-meta';
        meta.textContent = `Comissões: ${formatCurrency(wallet.commissionTotal)} · Retirado: ${formatCurrency(wallet.withdrawalTotal)}`;
        card.append(header, balance, meta);
        card.addEventListener('click', () => selectWallet(seller.id));
        dom.walletList.append(card);
      }
    }

    function renderWalletMovements() {
      const seller = getActiveWalletSeller();
      dom.walletMovements.replaceChildren();
      if (!seller) {
        dom.walletHistoryTitle.textContent = 'Movimentações da carteira';
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.textContent = 'Selecione um vendedor para ver as movimentações.';
        dom.walletMovements.append(empty);
        return;
      }
      dom.walletHistoryTitle.textContent = `Movimentações — ${seller.name}`;
      const movements = buildWalletMovements(seller.id, state.commissions, state.withdrawals);
      if (!movements.length) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.textContent = 'Ainda não há movimentações nesta carteira.';
        dom.walletMovements.append(empty);
        return;
      }
      for (const movement of movements) {
        const item = document.createElement('li');
        item.className = 'withdrawal-item';
        const details = document.createElement('div');
        const value = document.createElement('strong');
        value.className = movement.type === 'commission' ? 'movement-credit' : 'movement-debit';
        value.textContent = `${movement.type === 'commission' ? '+' : '−'} ${formatCurrency(movement.value)}`;
        const description = document.createElement('p');
        description.textContent = `${movement.type === 'commission' ? 'Comissão' : 'Retirada'} · ${formatDate(movement.date)} · ${movement.description}`;
        details.append(value, description);
        item.append(details);
        if (movement.type === 'withdrawal') {
          item.append(createButton('Excluir retirada', 'button button-danger', () => deleteWithdrawal({ id: movement.id })));
        }
        dom.walletMovements.append(item);
      }
    }

    function renderCommissionSellerOptions() {
      const selectedSellerId = dom.commissionSeller.value;
      dom.commissionSeller.replaceChildren();

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Selecione um vendedor';
      dom.commissionSeller.append(placeholder);

      for (const seller of [...state.sellers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
        const option = document.createElement('option');
        option.value = seller.id;
        option.textContent = seller.name;
        dom.commissionSeller.append(option);
      }

      const hasSellers = state.sellers.length > 0;
      dom.commissionFields.disabled = !hasSellers;
      dom.commissionEmpty.hidden = hasSellers;
      if (state.sellers.some((seller) => seller.id === selectedSellerId)) {
        dom.commissionSeller.value = selectedSellerId;
      }
    }

    function renderFilterSellerOptions() {
      const selectedSellerId = dom.filterSeller.value;
      dom.filterSeller.replaceChildren();
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Todos os vendedores';
      dom.filterSeller.append(option);

      for (const seller of [...state.sellers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
        const sellerOption = document.createElement('option');
        sellerOption.value = seller.id;
        sellerOption.textContent = seller.name;
        dom.filterSeller.append(sellerOption);
      }

      if (state.sellers.some((seller) => seller.id === selectedSellerId)) {
        dom.filterSeller.value = selectedSellerId;
      }
    }

    function getCurrentFilters() {
      return {
        sellerId: dom.filterSeller.value,
        startDate: dom.filterStartDate.value,
        endDate: dom.filterEndDate.value,
      };
    }

    function getVisibleCommissions() {
      return sortCommissions(filterCommissions(state.commissions, getCurrentFilters()), sortState.field, sortState.direction);
    }

    function formatDate(value) {
      if (!value) return '—';
      return new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T00:00:00`));
    }

    function createCell(value) {
      const cell = document.createElement('td');
      cell.textContent = value;
      return cell;
    }

    function startCommissionEdit(record) {
      editingCommissionId = record.id;
      renderCommissionSellerOptions();
      dom.commissionSeller.value = record.sellerId;
      dom.commissionProduct.value = record.product || '';
      dom.commissionSaleValue.value = String(record.saleValue).replace('.', ',');
      dom.commissionType.value = record.commissionType;
      dom.commissionInput.value = String(record.commissionInput).replace('.', ',');
      dom.commissionDate.value = record.saleDate;
      dom.commissionNote.value = record.note || '';
      dom.commissionSubmit.textContent = 'Salvar alterações';
      dom.commissionCancel.hidden = false;
      showCommissionError();
      updateCommissionInputLabel();
      updateCommissionPreview();
      document.querySelector('#comissoes').scrollIntoView({ behavior: 'smooth', block: 'start' });
      dom.commissionProduct.focus();
    }

    async function deleteCommission(record) {
      if (!(await confirmar({
        titulo: 'Excluir comissão',
        mensagem: 'Excluir esta comissão? Esta ação não pode ser desfeita.',
        textoConfirmar: 'Excluir',
        perigoso: true,
      }))) return;
      const remainingCommissions = state.commissions.filter((commission) => commission.id !== record.id);
      if (!hasNonNegativeWalletBalance(record.sellerId, remainingCommissions, state.withdrawals)) {
        showMessage('Não é possível excluir esta comissão porque a carteira do vendedor ficaria negativa.', 'error');
        return;
      }
      state.commissions = remainingCommissions;
      if (!persistState()) return;
      if (editingCommissionId === record.id) resetCommissionForm();
      renderAll();
      showMessage('Comissão excluída.', 'success');
    }

    function renderHistory() {
      const commissions = getVisibleCommissions();
      dom.tableBody.replaceChildren();
      dom.historyStatus.textContent = `${commissions.length} ${commissions.length === 1 ? 'comissão encontrada' : 'comissões encontradas'}.`;

      for (const button of dom.sortButtons) {
        const active = button.dataset.sort === sortState.field;
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', active
          ? `${button.textContent}: ordenação ${sortState.direction === 'asc' ? 'crescente' : 'decrescente'}`
          : `Ordenar por ${button.textContent}`);
      }

      if (!commissions.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'table-empty';
        cell.textContent = 'Nenhuma comissão encontrada para os filtros atuais.';
        row.append(cell);
        dom.tableBody.append(row);
        return;
      }

      for (const record of commissions) {
        const row = document.createElement('tr');
        const commissionCell = createCell(formatCurrency(record.commissionValue));
        if (record.commissionType === 'percentage') {
          const detail = document.createElement('span');
          detail.className = 'cell-detail';
          detail.textContent = `${formatNumber(record.commissionInput)}% da venda`;
          commissionCell.append(' ', detail);
        }
        row.append(
          createCell(record.sellerName || 'Vendedor não encontrado'),
          createCell(record.product || '—'),
          createCell(formatCurrency(record.saleValue)),
          commissionCell,
          createCell(formatDate(record.saleDate)),
        );

        const actionsCell = document.createElement('td');
        const actions = document.createElement('div');
        actions.className = 'table-actions';
        actions.append(
          createButton('Editar comissão', 'button button-secondary', () => startCommissionEdit(record)),
          createButton('Excluir comissão', 'button button-danger', () => deleteCommission(record)),
        );
        actionsCell.append(actions);
        row.append(actionsCell);
        dom.tableBody.append(row);
      }
    }

    function renderSummary() {
      const filters = getCurrentFilters();
      const commissions = filterCommissions(state.commissions, filters);
      const withdrawals = filterWithdrawals(state.withdrawals, filters);
      const summary = summarizeCommissions(commissions);
      const withdrawalsTotal = Math.round((withdrawals.reduce((sum, item) => sum + item.value, 0) + Number.EPSILON) * 100) / 100;
      // O saldo é acumulado: respeita o vendedor escolhido, mas não o período.
      const balance = calculateBalance(
        filterCommissions(state.commissions, { sellerId: filters.sellerId }),
        filterWithdrawals(state.withdrawals, { sellerId: filters.sellerId }),
      );
      dom.summaryBalance.textContent = formatCurrency(balance.balance);
      dom.summaryTotal.textContent = formatCurrency(summary.total);
      dom.summaryWithdrawals.textContent = formatCurrency(withdrawalsTotal);
      dom.summaryCount.textContent = String(summary.count);
      dom.summarySellers.textContent = String(summary.bySeller.length);
      renderChart(summary.bySeller);
    }

    function renderChart(bySeller) {
      dom.chart.replaceChildren();
      if (!bySeller.length) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.textContent = 'Sem comissões no período selecionado.';
        dom.chart.append(empty);
        return;
      }

      const maximum = bySeller[0].total || 1;
      for (const seller of bySeller) {
        const item = document.createElement('li');
        item.className = 'chart-item';
        const label = document.createElement('span');
        label.className = 'chart-label';
        label.textContent = seller.sellerName;
        const track = document.createElement('div');
        track.className = 'chart-track';
        const bar = document.createElement('span');
        bar.className = 'chart-bar-fill';
        bar.style.width = `${Math.max(12, Math.round(seller.total / maximum * 100))}%`;
        bar.textContent = formatCurrency(seller.total);
        track.append(bar);
        item.append(label, track);
        dom.chart.append(item);
      }
    }

    function baixarArquivo(content, filename, mime = 'text/plain;charset=utf-8') {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function paraISO(data) {
      return new Date(data.getTime() - data.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }

    function periodoMesAtual() {
      const hoje = new Date();
      const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      return { startDate: paraISO(primeiro), endDate: paraISO(ultimo) };
    }

    function renderClosing() {
      const periodo = { startDate: dom.closingStart.value, endDate: dom.closingEnd.value };
      const closing = buildClosing(state.commissions, state.withdrawals, periodo);
      dom.closingBody.replaceChildren();

      if (!closing.rows.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.className = 'table-empty';
        cell.textContent = 'Nenhuma movimentação no período selecionado.';
        row.append(cell);
        dom.closingBody.append(row);
      } else {
        for (const linha of closing.rows) {
          const row = document.createElement('tr');
          row.append(
            createCell(linha.sellerName),
            createCell(formatCurrency(linha.commissionTotal)),
            createCell(formatCurrency(linha.withdrawalTotal)),
            createCell(formatCurrency(linha.balance)),
          );
          dom.closingBody.append(row);
        }
        const rodape = document.createElement('tr');
        rodape.className = 'closing-total';
        rodape.append(
          createCell('Total'),
          createCell(formatCurrency(closing.totals.commissionTotal)),
          createCell(formatCurrency(closing.totals.withdrawalTotal)),
          createCell(formatCurrency(closing.totals.balance)),
        );
        dom.closingBody.append(rodape);
      }

      dom.closingStatus.textContent = `${closing.rows.length} vendedor(es) com movimentação no período.`;
      return closing;
    }

    function renderAll() {
      renderSellers();
      renderCommissionSellerOptions();
      renderFilterSellerOptions();
      renderWithdrawalSellerOptions();
      renderWallets();
      renderWalletMovements();
      renderSummary();
      renderHistory();
      renderClosing();
      updateWithdrawalPreview();
    }

    dom.sellerForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const validation = validateSeller({
        name: dom.sellerName.value,
      });

      if (!validation.valid) {
        showSellerError(validation.error);
        focarErro(validation.error, [[/nome/i, dom.sellerName]], dom.sellerName);
        return;
      }

      const now = new Date().toISOString();
      if (editingSellerId) {
        const existing = state.sellers.find((seller) => seller.id === editingSellerId);
        if (!existing) {
          resetSellerForm();
          showMessage('O vendedor que estava em edição não foi encontrado.', 'error');
          return;
        }
        Object.assign(existing, validation.value);
        state.commissions = state.commissions.map((commission) => (
          commission.sellerId === existing.id
            ? { ...commission, sellerName: existing.name, updatedAt: now }
            : commission
        ));
        state.withdrawals = state.withdrawals.map((withdrawal) => (
          withdrawal.sellerId === existing.id
            ? { ...withdrawal, sellerName: existing.name }
            : withdrawal
        ));
      } else {
        state.sellers.push({ id: createId(), ...validation.value, createdAt: now });
      }

      if (!persistState()) return;
      const action = editingSellerId ? 'alterado' : 'cadastrado';
      resetSellerForm();
      renderAll();
      showMessage(`Vendedor ${action}.`, 'success');
    });

    dom.commissionForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = getCommissionInput();
      const validation = validateCommission(input, state.sellers);
      if (!validation.valid) {
        showCommissionError(validation.error);
        focarErro(validation.error, [
          [/vendedor/i, dom.commissionSeller],
          [/valor de venda/i, dom.commissionSaleValue],
          [/tipo de comissão/i, dom.commissionType],
          [/comissão/i, dom.commissionInput],
          [/data/i, dom.commissionDate],
        ], dom.commissionSaleValue);
        return;
      }

      const record = createCommission(input, state.sellers);
      if (!record) {
        showCommissionError('Não foi possível criar a comissão. Revise os campos informados.');
        return;
      }

      let nextCommissions;
      let affectedSellerIds;
      if (editingCommissionId) {
        const original = state.commissions.find((commission) => commission.id === editingCommissionId);
        if (!original) {
          resetCommissionForm();
          showMessage('A comissão que estava em edição não foi encontrada.', 'error');
          return;
        }
        const updatedRecord = { ...record, id: original.id, createdAt: original.createdAt };
        nextCommissions = state.commissions.map((commission) => (
          commission.id === editingCommissionId ? updatedRecord : commission
        ));
        affectedSellerIds = [original.sellerId, updatedRecord.sellerId];
      } else {
        nextCommissions = [...state.commissions, record];
        affectedSellerIds = [record.sellerId];
      }
      if (affectedSellerIds.some((sellerId) => !hasNonNegativeWalletBalance(sellerId, nextCommissions, state.withdrawals))) {
        showCommissionError('Essa alteração deixaria uma carteira negativa porque há retiradas já registradas.');
        return;
      }
      state.commissions = nextCommissions;

      if (!persistState()) return;
      const action = editingCommissionId ? 'alterada' : 'salva';
      resetCommissionForm();
      renderAll();
      showMessage(`Comissão ${action}.`, 'success');
    });

    dom.withdrawalForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = getWithdrawalInput();
      const availableBalance = getAvailableBalance(input.sellerId);
      const validation = validateWithdrawal(input, state.sellers, availableBalance);
      if (!validation.valid) {
        showWithdrawalError(validation.error);
        focarErro(validation.error, [
          [/vendedor/i, dom.withdrawalSeller],
          [/valor/i, dom.withdrawalValue],
          [/data/i, dom.withdrawalDate],
        ], dom.withdrawalValue);
        return;
      }

      const withdrawal = createWithdrawal(input, state.sellers, availableBalance);
      if (!withdrawal) {
        showWithdrawalError('Não foi possível registrar a retirada. Revise os campos informados.');
        return;
      }
      state.withdrawals.push(withdrawal);
      if (!persistState()) return;
      resetWithdrawalForm();
      renderAll();
      showMessage(`Retirada registrada na carteira de ${withdrawal.sellerName}.`, 'success');
    });

    dom.withdrawalSeller.addEventListener('change', () => selectWallet(dom.withdrawalSeller.value));
    dom.withdrawalValue.addEventListener('input', updateWithdrawalPreview);

    dom.commissionCancel.addEventListener('click', resetCommissionForm);
    dom.commissionSaleValue.addEventListener('input', updateCommissionPreview);
    dom.commissionInput.addEventListener('input', updateCommissionPreview);
    dom.commissionType.addEventListener('change', () => {
      updateCommissionInputLabel();
      updateCommissionPreview();
    });

    function updateViewsFromFilters() {
      const { startDate, endDate } = getCurrentFilters();
      if (startDate && endDate && startDate > endDate) {
        showFilterError('A data inicial não pode ser posterior à data final.');
        return;
      }
      showFilterError();
      renderSummary();
      renderHistory();
    }

    dom.filterSeller.addEventListener('change', updateViewsFromFilters);
    dom.filterStartDate.addEventListener('change', updateViewsFromFilters);
    dom.filterEndDate.addEventListener('change', updateViewsFromFilters);
    dom.filterClear.addEventListener('click', () => {
      dom.filterSeller.value = '';
      dom.filterStartDate.value = '';
      dom.filterEndDate.value = '';
      showFilterError();
      renderSummary();
      renderHistory();
    });
    dom.exportCsv.addEventListener('click', () => {
      const { startDate, endDate } = getCurrentFilters();
      if (startDate && endDate && startDate > endDate) {
        showFilterError('A data inicial não pode ser posterior à data final.');
        return;
      }
      const commissions = getVisibleCommissions();
      if (!commissions.length) {
        showMessage('Não há comissões para exportar com os filtros atuais.', 'info');
        return;
      }
      baixarArquivo(buildCommissionCsv(commissions), `comissoes-${todayLocal()}.csv`, 'text/csv;charset=utf-8');
      showMessage('CSV exportado.', 'success');
    });

    /* -------- Fechamento do período -------- */
    dom.closingStart.addEventListener('change', renderClosing);
    dom.closingEnd.addEventListener('change', renderClosing);
    dom.closingExport.addEventListener('click', () => {
      const periodo = { startDate: dom.closingStart.value, endDate: dom.closingEnd.value };
      if (periodo.startDate && periodo.endDate && periodo.startDate > periodo.endDate) {
        showMessage('No fechamento, a data inicial não pode ser posterior à data final.', 'error');
        return;
      }
      const closing = renderClosing();
      if (!closing.rows.length) {
        showMessage('Não há movimentação para exportar nesse período.', 'info');
        return;
      }
      baixarArquivo(buildClosingCsv(closing, periodo), `fechamento-${periodo.startDate || 'inicio'}-a-${periodo.endDate || todayLocal()}.csv`, 'text/csv;charset=utf-8');
      showMessage('Fechamento exportado.', 'success');
    });

    /* -------- Backup em JSON -------- */
    dom.exportJson.addEventListener('click', () => {
      baixarArquivo(
        JSON.stringify(buildBackup(state), null, 2),
        `comissoes-backup-${todayLocal()}.json`,
        'application/json',
      );
      showMessage('Backup exportado. Guarde o arquivo em um local seguro.', 'success');
    });

    dom.importJson.addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', async () => {
      const arquivo = dom.importFile.files?.[0];
      dom.importFile.value = '';
      if (!arquivo) return;

      const estado = parseBackup(await arquivo.text());
      if (!estado) {
        showMessage('Arquivo inválido. Selecione um backup .json exportado por este painel.', 'error');
        return;
      }

      const confirmado = await confirmar({
        titulo: 'Importar backup',
        mensagem: `Isto substitui os dados atuais por ${estado.sellers.length} vendedor(es), ${estado.commissions.length} comissão(ões) e ${estado.withdrawals.length} retirada(s). Deseja continuar?`,
        textoConfirmar: 'Substituir',
        perigoso: true,
      });
      if (!confirmado) return;

      state = estado;
      activeWalletSellerId = null;
      resetSellerForm();
      resetCommissionForm();
      resetWithdrawalForm();
      if (!persistState()) return;
      renderAll();
      showMessage('Backup importado com sucesso.', 'success');
    });
    for (const button of dom.sortButtons) {
      button.addEventListener('click', () => {
        const field = button.dataset.sort;
        sortState = {
          field,
          direction: sortState.field === field && sortState.direction === 'desc' ? 'asc' : 'desc',
        };
        renderHistory();
      });
    }

    dom.sellerCancel.addEventListener('click', resetSellerForm);
    const periodoInicial = periodoMesAtual();
    dom.closingStart.value = periodoInicial.startDate;
    dom.closingEnd.value = periodoInicial.endDate;
    resetCommissionForm();
    resetWithdrawalForm();
    renderAll();
  });
}
