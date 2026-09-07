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
    };

    let state = loadState(window.localStorage);
    let editingSellerId = null;

    function showMessage(text, type = 'info') {
      dom.message.textContent = text;
      dom.message.className = `app-message ${type}`;
      dom.message.hidden = false;
    }

    function showSellerError(text = '') {
      dom.sellerError.textContent = text;
      dom.sellerError.hidden = !text;
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
            renderSellers();
            showMessage('Vendedor excluído.', 'success');
          }),
        );

        item.append(details, actions);
        dom.sellerList.append(item);
      }
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
      renderSellers();
      showMessage(`Vendedor ${action}.`, 'success');
    });

    dom.sellerCancel.addEventListener('click', resetSellerForm);
    renderSellers();
  });
}
