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

function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createEmptyState() {
  return { sellers: [], commissions: [] };
}

function sanitizeState(raw) {
  if (!raw || !Array.isArray(raw.sellers) || !Array.isArray(raw.commissions)) {
    return createEmptyState();
  }
  return { sellers: raw.sellers, commissions: raw.commissions };
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
      contact: String(contact || '').trim(),
    },
  };
}

function sellerHasCommissions(state, sellerId) {
  return state.commissions.some((commission) => commission.sellerId === sellerId);
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
  validateCommission,
  createCommission,
  filterCommissions,
  sortCommissions,
  summarizeCommissions,
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
      sellerContact: document.querySelector('#seller-contact'),
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
      filterSeller: document.querySelector('#filter-seller'),
      filterStartDate: document.querySelector('#filter-start-date'),
      filterEndDate: document.querySelector('#filter-end-date'),
      filterError: document.querySelector('#filter-error'),
      filterClear: document.querySelector('#filter-clear'),
      summaryTotal: document.querySelector('#summary-total'),
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
    let sortState = { field: 'saleDate', direction: 'desc' };

    function showMessage(text, type = 'info') {
      dom.message.textContent = text;
      dom.message.className = `app-message ${type}`;
      dom.message.hidden = false;
    }

    function showSellerError(text = '') {
      dom.sellerError.textContent = text;
      dom.sellerError.hidden = !text;
    }

    function showCommissionError(text = '') {
      dom.commissionError.textContent = text;
      dom.commissionError.hidden = !text;
    }

    function showFilterError(text = '') {
      dom.filterError.textContent = text;
      dom.filterError.hidden = !text;
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
        const contact = document.createElement('p');
        contact.textContent = seller.contact || 'Sem contato informado';
        details.append(name, contact);

        const actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.append(
          createButton('Editar vendedor', 'button button-secondary', () => {
            editingSellerId = seller.id;
            dom.sellerName.value = seller.name;
            dom.sellerContact.value = seller.contact || '';
            dom.sellerSubmit.textContent = 'Salvar alterações';
            dom.sellerCancel.hidden = false;
            showSellerError();
            dom.sellerName.focus();
          }),
          createButton('Excluir vendedor', 'button button-danger', () => {
            if (sellerHasCommissions(state, seller.id)) {
              showMessage('Não é possível excluir este vendedor porque há comissões no histórico.', 'error');
              return;
            }
            if (!window.confirm(`Excluir o vendedor ${seller.name}?`)) return;
            state.sellers = state.sellers.filter((item) => item.id !== seller.id);
            if (!persistState()) return;
            if (editingSellerId === seller.id) resetSellerForm();
            renderAll();
            showMessage('Vendedor excluído.', 'success');
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
      updateCommissionInputLabel();
      updateCommissionPreview();
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

    function deleteCommission(record) {
      if (!window.confirm('Excluir esta comissão? Esta ação não pode ser desfeita.')) return;
      state.commissions = state.commissions.filter((commission) => commission.id !== record.id);
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
        row.append(
          createCell(record.sellerName || 'Vendedor não encontrado'),
          createCell(record.product || '—'),
          createCell(formatCurrency(record.saleValue)),
          createCell(formatCurrency(record.commissionValue)),
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
      const summary = summarizeCommissions(getVisibleCommissions());
      dom.summaryTotal.textContent = formatCurrency(summary.total);
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

    function renderAll() {
      renderSellers();
      renderCommissionSellerOptions();
      renderFilterSellerOptions();
      renderSummary();
      renderHistory();
    }

    dom.sellerForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const validation = validateSeller({
        name: dom.sellerName.value,
        contact: dom.sellerContact.value,
      });

      if (!validation.valid) {
        showSellerError(validation.error);
        dom.sellerName.focus();
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
        return;
      }

      const record = createCommission(input, state.sellers);
      if (!record) {
        showCommissionError('Não foi possível criar a comissão. Revise os campos informados.');
        return;
      }

      if (editingCommissionId) {
        const original = state.commissions.find((commission) => commission.id === editingCommissionId);
        if (!original) {
          resetCommissionForm();
          showMessage('A comissão que estava em edição não foi encontrada.', 'error');
          return;
        }
        state.commissions = state.commissions.map((commission) => (
          commission.id === editingCommissionId
            ? { ...record, id: original.id, createdAt: original.createdAt }
            : commission
        ));
      } else {
        state.commissions.push(record);
      }

      if (!persistState()) return;
      const action = editingCommissionId ? 'alterada' : 'salva';
      resetCommissionForm();
      renderAll();
      showMessage(`Comissão ${action}.`, 'success');
    });

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
    resetCommissionForm();
    renderAll();
  });
}
