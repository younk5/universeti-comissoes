import {
  calculateCommissionPreview, formatCurrency, formatDate, formatPercent, sumCurrency,
} from '../format.js';
import { canAutoStartTour, createTour, hasSeenTour, tourStorageKey } from './tour.js';
import { createHelpMode, helpStorageKey } from './help-mode.js';
import { checklistStorageKey, createChecklist } from './checklist.js';

function createElement(document, tagName, { className, text, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function createCell(document, value, className = '', attributes = {}) {
  return createElement(document, 'td', { className, text: value, attributes });
}

function releaseObjectUrl(objectUrl) {
  const urlApi = globalThis.URL;
  const release = () => {
    if (typeof urlApi?.revokeObjectURL === 'function') urlApi.revokeObjectURL(objectUrl);
  };
  if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(release, 0);
  else release();
}

function createHeaderCell(document, value) {
  return createElement(document, 'th', { text: value, attributes: { scope: 'col' } });
}

function createLabeledControl(document, {
  id, label, type = 'text', required = false, attributes = {},
}) {
  const wrapper = createElement(document, 'div', { className: 'field-group' });
  const labelElement = createElement(document, 'label', { text: label, attributes: { for: id } });
  const control = createElement(document, 'input', {
    className: 'form-control',
    attributes: { id, name: id, type, ...(required ? { required: '' } : {}), ...attributes },
  });
  control.name = id;
  control.type = type;
  wrapper.append(labelElement, control);
  return { wrapper, label: labelElement, control };
}

function createLabeledSelect(document, { id, label, options = [] }) {
  const wrapper = createElement(document, 'div', { className: 'field-group' });
  const labelElement = createElement(document, 'label', { text: label, attributes: { for: id } });
  const control = createElement(document, 'select', {
    className: 'form-control',
    attributes: { id, name: id },
  });
  control.name = id;
  for (const option of options) {
    const optionElement = createElement(document, 'option', { text: option.label, attributes: { value: option.value } });
    optionElement.value = option.value;
    control.append(optionElement);
  }
  wrapper.append(labelElement, control);
  return { wrapper, label: labelElement, control };
}

function createLabeledTextArea(document, { id, label }) {
  const wrapper = createElement(document, 'div', { className: 'field-group field-group--wide' });
  const labelElement = createElement(document, 'label', { text: label, attributes: { for: id } });
  const control = createElement(document, 'textarea', {
    className: 'form-control',
    attributes: { id, name: id, rows: '3' },
  });
  control.name = id;
  wrapper.append(labelElement, control);
  return { wrapper, label: labelElement, control };
}

function clearAndAppend(parent, children) {
  parent.replaceChildren(...children);
}

function setFeedback(feedback, message = '', state = message ? 'success' : '') {
  feedback.textContent = message;
  feedback.setAttribute('data-state', state);
}

function setButtonBusy(button, busy) {
  button.setAttribute('aria-busy', String(busy));
}

function commissionTotals(commissions) {
  return commissions.reduce((totals, commission) => ({
    pending: commission.paymentStatus === 'pending'
      ? sumCurrency(totals.pending, commission.commissionValue ?? '0.00')
      : totals.pending,
    paid: commission.paymentStatus === 'paid'
      ? sumCurrency(totals.paid, commission.commissionValue ?? '0.00')
      : totals.paid,
  }), { pending: '0.00', paid: '0.00' });
}

function operationalCommissions(commissions) {
  return commissions.filter((commission) => (
    commission.paymentStatus === 'pending' || commission.paymentStatus === 'paid'
  ));
}

function operationalSummary(commissions) {
  return operationalCommissions(commissions).reduce((summary, commission) => ({
    count: summary.count + 1,
    sales: sumCurrency(summary.sales, commission.saleValue ?? '0.00'),
    pending: commission.paymentStatus === 'pending'
      ? sumCurrency(summary.pending, commission.commissionValue ?? '0.00')
      : summary.pending,
    paid: commission.paymentStatus === 'paid'
      ? sumCurrency(summary.paid, commission.commissionValue ?? '0.00')
      : summary.paid,
  }), {
    count: 0, sales: '0.00', pending: '0.00', paid: '0.00',
  });
}

function compareCurrency(left, right) {
  const toCents = (value) => {
    const [integerPart, fractionalPart = ''] = String(value).split('.');
    return BigInt(integerPart) * 100n + BigInt(fractionalPart.padEnd(2, '0'));
  };
  const difference = toCents(left) - toCents(right);
  return difference === 0n ? 0 : (difference > 0n ? 1 : -1);
}

function sellerTotals(sellers, commissions) {
  return sellers.map((seller) => {
    const sellerCommissions = operationalCommissions(commissions)
      .filter((commission) => commission.sellerId === seller.id);
    const totals = commissionTotals(sellerCommissions);
    return { seller, ...totals, total: sumCurrency(totals.pending, totals.paid) };
  }).sort((left, right) => compareCurrency(right.total, left.total));
}

function createEmptyRow(document, message, columns) {
  const row = createElement(document, 'tr', { className: 'table-empty-row' });
  const cell = createElement(document, 'td', {
    text: message,
    attributes: { colspan: String(columns) },
  });
  row.append(cell);
  return row;
}

function formatLocalDateTime(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function renderAdmin(root, { api, actor, onSignOut } = {}) {
  const document = root.ownerDocument ?? globalThis.document;
  const state = {
    sellers: [],
    commissions: [],
    initialLoadPending: true,
    initialLoadFailed: false,
    sellerEditId: null,
    commissionEditId: null,
    commissionEditProductId: null,
    commissionProductSelectionId: '',
    commissionProductSelectionChanged: false,
    products: [],
    productsLoaded: false,
    productsPending: false,
    productsGeneration: 0,
    defaultRule: null,
    defaultRuleLoaded: false,
    defaultRulePending: false,
    defaultRuleGeneration: 0,
    defaultRuleMutationPending: false,
    productMutationPending: false,
    productEditId: null,
    productPendingCounts: new Map(),
    filters: { sellerId: '', startDate: '', endDate: '', paymentStatus: '' },
    commissionFilterGeneration: 0,
    commissionFilterRequestPending: false,
    commissionBatchPaymentPending: false,
    commissionCsvDownloadPending: false,
    adminBackupDownloadPending: false,
    auditEvents: [],
    auditEventsLoaded: false,
    auditEventsStale: false,
    auditEventsPending: false,
    auditEventsGeneration: 0,
    administrators: [],
    administratorsLoaded: false,
    administratorsPending: false,
    administratorCreatePending: false,
  };
  const commissionSelection = new Map();
  const main = createElement(document, 'main', {
    className: 'app-shell admin-shell',
    attributes: { 'aria-labelledby': 'admin-title' },
  });
  const helpMode = createHelpMode(document, { storageKey: helpStorageKey('admin'), container: main });
  const header = createElement(document, 'header', { className: 'session-header admin-header' });
  const logo = createElement(document, 'img', {
    className: 'brand-logo brand-logo--compact',
    attributes: {
      src: '/assets/universe-ti.svg',
      alt: 'Universe TI',
    },
  });
  const headerText = createElement(document, 'div', { className: 'admin-heading' });
  const title = createElement(document, 'h1', { text: 'Administração de comissões', attributes: { id: 'admin-title' } });
  const greeting = createElement(document, 'p', { text: `Olá, ${actor?.name ?? 'Administração'}.` });
  const signOutButton = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Sair',
    attributes: { type: 'button' },
  });
  signOutButton.addEventListener('click', onSignOut);
  const tourButton = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Ajuda',
    attributes: { type: 'button' },
  });
  headerText.append(title, greeting);
  header.append(logo, headerText, helpMode.button, tourButton, signOutButton);

  const navigation = createElement(document, 'nav', {
    className: 'admin-tabs',
    attributes: { 'aria-label': 'Seções da administração', role: 'tablist' },
  });
  const content = createElement(document, 'div', { className: 'admin-content' });
  const summaryPanel = createElement(document, 'section', {
    className: 'admin-panel admin-panel--summary',
    attributes: { role: 'tabpanel', 'aria-labelledby': 'admin-tab-summary' },
  });
  const sellersPanel = createElement(document, 'section', {
    className: 'admin-panel',
    attributes: { role: 'tabpanel', 'aria-labelledby': 'admin-tab-sellers', hidden: '' },
  });
  sellersPanel.hidden = true;
  const commissionsPanel = createElement(document, 'section', {
    className: 'admin-panel',
    attributes: { role: 'tabpanel', 'aria-labelledby': 'admin-tab-commissions', hidden: '' },
  });
  commissionsPanel.hidden = true;
  const productsPanel = createElement(document, 'section', {
    className: 'admin-panel',
    attributes: { role: 'tabpanel', 'aria-labelledby': 'admin-tab-products', hidden: '' },
  });
  productsPanel.hidden = true;
  const historyPanel = createElement(document, 'section', {
    className: 'admin-panel',
    attributes: { role: 'tabpanel', 'aria-labelledby': 'admin-tab-history', hidden: '' },
  });
  historyPanel.hidden = true;
  const administratorsPanel = createElement(document, 'section', {
    className: 'admin-panel',
    attributes: { role: 'tabpanel', 'aria-labelledby': 'admin-tab-administrators', hidden: '' },
  });
  administratorsPanel.hidden = true;

  const tabs = {
    resumo: createElement(document, 'button', {
      className: 'admin-tab',
      text: 'Resumo',
      attributes: { id: 'admin-tab-summary', type: 'button', role: 'tab', 'aria-controls': 'admin-summary', 'aria-selected': 'true' },
    }),
    vendedores: createElement(document, 'button', {
      className: 'admin-tab',
      text: 'Vendedores',
      attributes: { id: 'admin-tab-sellers', type: 'button', role: 'tab', 'aria-controls': 'admin-sellers', 'aria-selected': 'false', tabindex: '-1' },
    }),
    comissoes: createElement(document, 'button', {
      className: 'admin-tab',
      text: 'Comissões',
      attributes: { id: 'admin-tab-commissions', type: 'button', role: 'tab', 'aria-controls': 'admin-commissions', 'aria-selected': 'false', tabindex: '-1' },
    }),
    produtos: createElement(document, 'button', {
      className: 'admin-tab',
      text: 'Produtos',
      attributes: { id: 'admin-tab-products', type: 'button', role: 'tab', 'aria-controls': 'admin-products', 'aria-selected': 'false', tabindex: '-1' },
    }),
    historico: createElement(document, 'button', {
      className: 'admin-tab',
      text: 'Histórico',
      attributes: { id: 'admin-tab-history', type: 'button', role: 'tab', 'aria-controls': 'admin-history', 'aria-selected': 'false', tabindex: '-1' },
    }),
    administradores: createElement(document, 'button', {
      className: 'admin-tab',
      text: 'Administradores',
      attributes: { id: 'admin-tab-administrators', type: 'button', role: 'tab', 'aria-controls': 'admin-administrators', 'aria-selected': 'false', tabindex: '-1' },
    }),
  };
  summaryPanel.setAttribute('id', 'admin-summary');
  sellersPanel.setAttribute('id', 'admin-sellers');
  commissionsPanel.setAttribute('id', 'admin-commissions');
  productsPanel.setAttribute('id', 'admin-products');
  historyPanel.setAttribute('id', 'admin-history');
  administratorsPanel.setAttribute('id', 'admin-administrators');
  navigation.append(tabs.resumo, tabs.vendedores, tabs.comissoes, tabs.produtos, tabs.historico, tabs.administradores);

  const summaryTitle = createElement(document, 'h2', { text: 'Visão financeira' });
  const summaryFeedback = createElement(document, 'p', {
    className: 'form-feedback',
    text: 'Carregando dados da administração.',
    attributes: { 'aria-live': 'polite' },
  });
  const retryInitialLoadButton = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Tentar novamente',
    attributes: { type: 'button', hidden: '' },
  });
  const summaryFilterStatus = createElement(document, 'p', {
    className: 'panel-description',
    attributes: { 'aria-live': 'polite' },
  });
  const summaryCards = createElement(document, 'dl', { className: 'summary-metrics', attributes: { 'aria-live': 'polite' } });
  const salesMetric = createElement(document, 'div', { className: 'summary-metric' });
  const salesLabel = createElement(document, 'dt', { text: 'Vendas registradas' });
  const sales = createElement(document, 'dd', { text: formatCurrency(0) });
  const pendingMetric = createElement(document, 'div', { className: 'summary-metric' });
  const pendingLabel = createElement(document, 'dt', { text: 'A pagar' });
  const pending = createElement(document, 'dd', { text: formatCurrency(0) });
  const paidMetric = createElement(document, 'div', { className: 'summary-metric' });
  const paidLabel = createElement(document, 'dt', { text: 'Pago' });
  const paid = createElement(document, 'dd', { text: formatCurrency(0) });
  const totalMetric = createElement(document, 'div', { className: 'summary-metric' });
  const totalLabel = createElement(document, 'dt', { text: 'Total de comissões' });
  const total = createElement(document, 'dd', { text: formatCurrency(0) });
  const countMetric = createElement(document, 'div', { className: 'summary-metric' });
  const countLabel = createElement(document, 'dt', { text: 'Registros' });
  const count = createElement(document, 'dd', { text: '0' });
  salesMetric.append(salesLabel, sales);
  pendingMetric.append(pendingLabel, pending);
  paidMetric.append(paidLabel, paid);
  totalMetric.append(totalLabel, total);
  countMetric.append(countLabel, count);
  summaryCards.append(salesMetric, pendingMetric, paidMetric, totalMetric, countMetric);
  const operationalNotice = createElement(document, 'p', {
    className: 'panel-description',
    text: 'Comissões anuladas ficam fora do resumo operacional.',
  });

  const sellerTotalsTitle = createElement(document, 'h3', { text: 'Totais por vendedor' });
  const sellerTotalsTable = createElement(document, 'table', { className: 'data-table', attributes: { 'aria-label': 'Totais por vendedor' } });
  const sellerTotalsHead = createElement(document, 'thead');
  const sellerTotalsHeaderRow = createElement(document, 'tr');
  sellerTotalsHeaderRow.append(
    createHeaderCell(document, 'Posição'),
    createHeaderCell(document, 'Vendedor'),
    createHeaderCell(document, 'A pagar'),
    createHeaderCell(document, 'Pago'),
    createHeaderCell(document, 'Total'),
  );
  sellerTotalsHead.append(sellerTotalsHeaderRow);
  const sellerTotalRows = createElement(document, 'tbody');
  sellerTotalsTable.append(sellerTotalsHead, sellerTotalRows);
  const backupButton = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Baixar cópia administrativa',
    attributes: { type: 'button' },
  });
  const backupFeedback = createElement(document, 'p', {
    className: 'form-feedback',
    attributes: { 'aria-live': 'polite' },
  });
  const checklist = createChecklist(document, {
    storageKey: checklistStorageKey('admin'),
    items: [
      { id: 'seller', label: 'Cadastre um vendedor', hint: 'Aba Vendedores' },
      { id: 'product', label: 'Defina um produto e a comissão padrão', hint: 'Aba Produtos' },
      { id: 'commission', label: 'Registre uma comissão', hint: 'Aba Comissões' },
    ],
  });
  summaryPanel.append(
    summaryTitle,
    summaryFeedback,
    retryInitialLoadButton,
    summaryFilterStatus,
    summaryCards,
    checklist.element,
    operationalNotice,
    sellerTotalsTitle,
    sellerTotalsTable,
    backupButton,
    backupFeedback,
  );

  const sellersTitle = createElement(document, 'h2', { text: 'Vendedores' });
  const sellersDescription = createElement(document, 'p', { className: 'panel-description', text: 'Cadastre e acompanhe os perfis que recebem comissões.' });
  const sellerFormSection = createElement(document, 'section', { className: 'admin-form-section', attributes: { 'aria-labelledby': 'seller-form-title' } });
  const sellerFormTitle = createElement(document, 'h3', { text: 'Cadastrar vendedor', attributes: { id: 'seller-form-title' } });
  const sellerForm = createElement(document, 'form', { className: 'admin-form seller-form' });
  const sellerName = createLabeledControl(document, { id: 'seller-name', label: 'Nome', required: true, attributes: { autocomplete: 'name' } });
  const sellerUsername = createLabeledControl(document, { id: 'seller-username', label: 'Usuário', required: true, attributes: { autocomplete: 'username' } });
  const sellerPassword = createLabeledControl(document, { id: 'seller-password', label: 'Senha inicial', type: 'password', required: true, attributes: { autocomplete: 'new-password', minlength: '6' } });
  const sellerPhone = createLabeledControl(document, { id: 'seller-phone', label: 'Telefone (opcional)', type: 'tel', attributes: { autocomplete: 'tel' } });
  const sellerFeedback = createElement(document, 'p', {
    className: 'form-feedback',
    attributes: { 'aria-live': 'polite' },
  });
  const sellerRecovery = createElement(document, 'div', { className: 'form-recovery' });
  const sellerTemporaryPassword = createElement(document, 'p', {
    className: 'form-recovery',
    attributes: { 'aria-live': 'polite' },
  });
  const sellerSubmit = createElement(document, 'button', {
    className: 'button button-primary',
    text: 'Cadastrar vendedor',
    attributes: { type: 'submit' },
  });
  sellerForm.append(
    sellerName.wrapper,
    sellerUsername.wrapper,
    sellerPassword.wrapper,
    sellerPhone.wrapper,
    sellerFeedback,
    sellerRecovery,
    sellerTemporaryPassword,
    sellerSubmit,
  );
  sellerFormSection.append(sellerFormTitle, sellerForm);

  const sellerTable = createElement(document, 'table', { className: 'data-table', attributes: { 'aria-label': 'Vendedores cadastrados' } });
  const sellerHead = createElement(document, 'thead');
  const sellerHeaderRow = createElement(document, 'tr');
  sellerHeaderRow.append(
    createHeaderCell(document, 'Vendedor'),
    createHeaderCell(document, 'Usuário'),
    createHeaderCell(document, 'Telefone'),
    createHeaderCell(document, 'Situação'),
    createHeaderCell(document, 'Ações'),
  );
  sellerHead.append(sellerHeaderRow);
  const sellerRows = createElement(document, 'tbody');
  sellerTable.append(sellerHead, sellerRows);
  sellersPanel.append(sellersTitle, sellersDescription, sellerFormSection, sellerTable);

  const commissionsTitle = createElement(document, 'h2', { text: 'Comissões' });
  const commissionsDescription = createElement(document, 'p', { className: 'panel-description', text: 'Acompanhe os registros e seus pagamentos.' });
  const commissionFormSection = createElement(document, 'section', { className: 'admin-form-section', attributes: { 'aria-labelledby': 'commission-form-title' } });
  const commissionFormTitle = createElement(document, 'h3', { text: 'Nova comissão', attributes: { id: 'commission-form-title' } });
  const commissionForm = createElement(document, 'form', { className: 'admin-form commission-form' });
  const commissionSeller = createLabeledSelect(document, { id: 'commission-seller', label: 'Vendedor' });
  const commissionProductId = createLabeledSelect(document, {
    id: 'commission-product',
    label: 'Produto do catálogo',
    options: [{ value: '', label: 'Lançamento manual ou legado' }],
  });
  const commissionProduct = createLabeledControl(document, { id: 'commission-product-manual', label: 'Produto ou serviço (manual ou legado)', required: true });
  const commissionSaleValue = createLabeledControl(document, { id: 'commission-sale-value', label: 'Valor da venda', type: 'number', required: true, attributes: { min: '0', step: '0.01', inputmode: 'decimal' } });
  const commissionSaleDate = createLabeledControl(document, { id: 'commission-sale-date', label: 'Data da venda', type: 'date', required: true });
  const commissionNote = createLabeledTextArea(document, { id: 'commission-note', label: 'Observação' });
  const commissionPreview = createElement(document, 'p', { className: 'commission-preview', text: 'Prévia da comissão: R$ 0,00', attributes: { 'aria-live': 'polite' } });
  const commissionSubmit = createElement(document, 'button', {
    className: 'button button-primary',
    text: 'Registrar comissão',
    attributes: { type: 'submit' },
  });
  commissionForm.append(
    commissionSeller.wrapper,
    commissionProductId.wrapper,
    commissionProduct.wrapper,
    commissionSaleValue.wrapper,
    commissionSaleDate.wrapper,
    commissionNote.wrapper,
    commissionPreview,
    commissionSubmit,
  );
  commissionFormSection.append(commissionFormTitle, commissionForm);

  const commissionFilterForm = createElement(document, 'form', { className: 'filter-form', attributes: { 'aria-label': 'Filtros de comissões' } });
  const filterSeller = createLabeledSelect(document, { id: 'filter-seller', label: 'Vendedor' });
  const filterStartDate = createLabeledControl(document, { id: 'filter-start-date', label: 'Data inicial', type: 'date' });
  const filterEndDate = createLabeledControl(document, { id: 'filter-end-date', label: 'Data final', type: 'date' });
  const filterPaymentStatus = createLabeledSelect(document, {
    id: 'filter-payment-status',
    label: 'Situação',
    options: [
      { value: '', label: 'Todas' },
      { value: 'pending', label: 'Pendente' },
      { value: 'paid', label: 'Pago' },
      { value: 'voided', label: 'Anulada' },
    ],
  });
  const filterSubmit = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Aplicar filtros',
    attributes: { type: 'submit' },
  });
  const csvButton = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Baixar CSV',
    attributes: { type: 'button' },
  });
  const commissionFeedback = createElement(document, 'p', {
    className: 'form-feedback',
    attributes: { 'aria-live': 'polite' },
  });
  commissionFilterForm.append(
    filterSeller.wrapper,
    filterStartDate.wrapper,
    filterEndDate.wrapper,
    filterPaymentStatus.wrapper,
    filterSubmit,
    csvButton,
    commissionFeedback,
  );

  const commissionActionBar = createElement(document, 'div', { className: 'commission-action-bar' });
  const markPaidButton = createElement(document, 'button', {
    className: 'button button-primary',
    text: 'Marcar selecionadas como pagas',
    attributes: { type: 'button' },
  });
  commissionActionBar.append(markPaidButton);

  const commissionTable = createElement(document, 'table', { className: 'data-table', attributes: { 'aria-label': 'Comissões' } });
  const commissionHead = createElement(document, 'thead');
  const commissionHeaderRow = createElement(document, 'tr');
  commissionHeaderRow.append(
    createHeaderCell(document, 'Selecionar'),
    createHeaderCell(document, 'Vendedor'),
    createHeaderCell(document, 'Produto'),
    createHeaderCell(document, 'Comissão'),
    createHeaderCell(document, 'Data'),
    createHeaderCell(document, 'Situação'),
    createHeaderCell(document, 'Ações'),
  );
  commissionHead.append(commissionHeaderRow);
  const commissionRows = createElement(document, 'tbody');
  commissionTable.append(commissionHead, commissionRows);
  commissionsPanel.append(commissionsTitle, commissionsDescription, commissionFormSection, commissionFilterForm, commissionActionBar, commissionTable);

  const productsTitle = createElement(document, 'h2', { text: 'Produtos' });
  const productsDescription = createElement(document, 'p', {
    className: 'panel-description',
    text: 'Gerencie as regras usadas nos novos lançamentos de comissão.',
  });
  const defaultRuleFormSection = createElement(document, 'section', {
    className: 'admin-form-section default-rule-form-section',
    attributes: { 'aria-labelledby': 'default-rule-form-title' },
  });
  const defaultRuleFormTitle = createElement(document, 'h3', {
    text: 'Comissão padrão para itens sem regra individual',
    attributes: { id: 'default-rule-form-title' },
  });
  const defaultRuleForm = createElement(document, 'form', { className: 'admin-form default-rule-form' });
  const defaultRuleCommissionType = createLabeledSelect(document, {
    id: 'default-rule-commission-type',
    label: 'Modalidade da comissão',
    options: [
      { value: 'percentage', label: 'Percentual' },
      { value: 'fixed', label: 'Valor fixo' },
    ],
  });
  const defaultRuleCommissionInput = createLabeledControl(document, {
    id: 'default-rule-commission-input', label: 'Valor da comissão', type: 'number', required: true,
    attributes: { min: '0', step: '0.01', inputmode: 'decimal' },
  });
  const defaultRuleFeedback = createElement(document, 'p', {
    className: 'form-feedback', attributes: { 'aria-live': 'polite' },
  });
  const defaultRuleSubmit = createElement(document, 'button', {
    className: 'button button-primary', text: 'Salvar comissão padrão', attributes: { type: 'submit' },
  });
  defaultRuleForm.append(
    defaultRuleCommissionType.wrapper,
    defaultRuleCommissionInput.wrapper,
    defaultRuleFeedback,
    defaultRuleSubmit,
  );
  defaultRuleFormSection.append(defaultRuleFormTitle, defaultRuleForm);
  const productFormSection = createElement(document, 'section', {
    className: 'admin-form-section',
    attributes: { 'aria-labelledby': 'product-form-title' },
  });
  const productFormTitle = createElement(document, 'h3', { text: 'Cadastrar produto', attributes: { id: 'product-form-title' } });
  const productForm = createElement(document, 'form', { className: 'admin-form product-form' });
  const productName = createLabeledControl(document, { id: 'product-name', label: 'Produto ou serviço', required: true, attributes: { maxlength: '200' } });
  const productCommissionType = createLabeledSelect(document, {
    id: 'product-commission-type',
    label: 'Modalidade da regra',
    options: [
      { value: 'percentage', label: 'Percentual' },
      { value: 'fixed', label: 'Valor fixo' },
    ],
  });
  const productCommissionInput = createLabeledControl(document, { id: 'product-commission-input', label: 'Valor da regra', type: 'number', required: true, attributes: { min: '0', step: '0.01', inputmode: 'decimal' } });
  const productFeedback = createElement(document, 'p', { className: 'form-feedback', attributes: { 'aria-live': 'polite' } });
  const productSubmit = createElement(document, 'button', {
    className: 'button button-primary', text: 'Cadastrar produto', attributes: { type: 'submit' },
  });
  productForm.append(productName.wrapper, productCommissionType.wrapper, productCommissionInput.wrapper, productFeedback, productSubmit);
  productFormSection.append(productFormTitle, productForm);
  const productTable = createElement(document, 'table', { className: 'data-table product-table', attributes: { 'aria-label': 'Catálogo de produtos' } });
  const productHead = createElement(document, 'thead');
  const productHeaderRow = createElement(document, 'tr');
  productHeaderRow.append(
    createHeaderCell(document, 'Produto'),
    createHeaderCell(document, 'Regra'),
    createHeaderCell(document, 'Situação'),
    createHeaderCell(document, 'Pendências afetadas'),
    createHeaderCell(document, 'Ações'),
  );
  productHead.append(productHeaderRow);
  const productRows = createElement(document, 'tbody');
  const productActionControls = new Set();
  productTable.append(productHead, productRows);
  productsPanel.append(productsTitle, productsDescription, defaultRuleFormSection, productFormSection, productTable);

  const historyTitle = createElement(document, 'h2', { text: 'Histórico financeiro' });
  const historyFeedback = createElement(document, 'p', {
    className: 'form-feedback',
    attributes: { 'aria-live': 'polite' },
  });
  const historyRefreshButton = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Atualizar histórico',
    attributes: { type: 'button', hidden: '' },
  });
  const historyTable = createElement(document, 'table', { className: 'data-table', attributes: { 'aria-label': 'Histórico financeiro' } });
  const historyHead = createElement(document, 'thead');
  const historyHeaderRow = createElement(document, 'tr');
  historyHeaderRow.append(
    createHeaderCell(document, 'Evento'),
    createHeaderCell(document, 'Vendedor'),
    createHeaderCell(document, 'Produto'),
    createHeaderCell(document, 'Comissão'),
    createHeaderCell(document, 'Responsável'),
    createHeaderCell(document, 'Data e hora'),
  );
  historyHead.append(historyHeaderRow);
  const historyRows = createElement(document, 'tbody');
  historyTable.append(historyHead, historyRows);
  historyPanel.append(historyTitle, historyFeedback, historyRefreshButton, historyTable);

  const administratorsTitle = createElement(document, 'h2', { text: 'Administradores' });
  const administratorsDescription = createElement(document, 'p', {
    className: 'panel-description',
    text: 'Cadastre administradores ativos para operar a plataforma.',
  });
  const administratorFormSection = createElement(document, 'section', {
    className: 'admin-form-section',
    attributes: { 'aria-labelledby': 'administrator-form-title' },
  });
  const administratorFormTitle = createElement(document, 'h3', {
    text: 'Cadastrar administrador',
    attributes: { id: 'administrator-form-title' },
  });
  const administratorForm = createElement(document, 'form', { className: 'admin-form administrator-form' });
  const administratorName = createLabeledControl(document, {
    id: 'administrator-name', label: 'Nome', required: true, attributes: { autocomplete: 'name' },
  });
  const administratorUsername = createLabeledControl(document, {
    id: 'administrator-username', label: 'Usuário', required: true, attributes: { autocomplete: 'username' },
  });
  const administratorPassword = createLabeledControl(document, {
    id: 'administrator-password', label: 'Senha inicial', type: 'password', required: true,
    attributes: { autocomplete: 'new-password', minlength: '6' },
  });
  const administratorFeedback = createElement(document, 'p', {
    className: 'form-feedback',
    attributes: { 'aria-live': 'polite' },
  });
  const administratorSubmit = createElement(document, 'button', {
    className: 'button button-primary',
    text: 'Cadastrar administrador',
    attributes: { type: 'submit' },
  });
  administratorForm.append(
    administratorName.wrapper,
    administratorUsername.wrapper,
    administratorPassword.wrapper,
    administratorFeedback,
    administratorSubmit,
  );
  administratorFormSection.append(administratorFormTitle, administratorForm);

  const administratorTable = createElement(document, 'table', { className: 'data-table', attributes: { 'aria-label': 'Administradores' } });
  const administratorHead = createElement(document, 'thead');
  const administratorHeaderRow = createElement(document, 'tr');
  administratorHeaderRow.append(
    createHeaderCell(document, 'Administrador'),
    createHeaderCell(document, 'Usuário'),
    createHeaderCell(document, 'Situação'),
    createHeaderCell(document, 'Ações'),
  );
  administratorHead.append(administratorHeaderRow);
  const administratorRows = createElement(document, 'tbody');
  administratorTable.append(administratorHead, administratorRows);
  administratorsPanel.append(
    administratorsTitle,
    administratorsDescription,
    administratorFormSection,
    administratorTable,
  );

  let confirmedAction;
  const confirmationDialog = createElement(document, 'dialog', {
    className: 'confirmation-dialog',
    attributes: {
      'aria-labelledby': 'confirmation-dialog-title',
      'aria-describedby': 'confirmation-dialog-description',
      'aria-modal': 'true',
      hidden: '',
    },
  });
  confirmationDialog.hidden = true;
  const confirmationTitle = createElement(document, 'h2', {
    text: 'Confirmar ação sensível',
    attributes: { id: 'confirmation-dialog-title' },
  });
  const confirmationDescription = createElement(document, 'p', {
    attributes: { id: 'confirmation-dialog-description' },
  });
  const confirmationForm = createElement(document, 'form', { className: 'confirmation-form' });
  const confirmationPassword = createLabeledControl(document, {
    id: 'confirmation-current-password',
    label: 'Sua senha atual',
    type: 'password',
    required: true,
    attributes: { autocomplete: 'current-password', minlength: '6' },
  });
  const confirmationActions = createElement(document, 'div', { className: 'table-actions' });
  const confirmationCancel = createElement(document, 'button', {
    className: 'button button-secondary',
    text: 'Cancelar',
    attributes: { type: 'button' },
  });
  const confirmationSubmit = createElement(document, 'button', {
    className: 'button button-danger',
    text: 'Confirmar arquivamento',
    attributes: { type: 'submit' },
  });
  confirmationActions.append(confirmationCancel, confirmationSubmit);
  confirmationForm.append(confirmationPassword.wrapper, confirmationActions);
  confirmationDialog.append(confirmationTitle, confirmationDescription, confirmationForm);

  function closeConfirmationDialog() {
    confirmationPassword.control.value = '';
    confirmedAction = undefined;
    if (typeof confirmationDialog.close === 'function' && confirmationDialog.open) confirmationDialog.close();
    confirmationDialog.removeAttribute('open');
    confirmationDialog.setAttribute('hidden', '');
    confirmationDialog.hidden = true;
  }

  function openConfirmationDialog({ title, description, submitLabel, action, requiresPassword = true }) {
    if (state.initialLoadPending || typeof action !== 'function') return;
    confirmationPassword.control.value = '';
    confirmationPassword.wrapper.hidden = !requiresPassword;
    if (requiresPassword) confirmationPassword.control.setAttribute('required', '');
    else confirmationPassword.control.removeAttribute('required');
    confirmedAction = action;
    confirmationTitle.textContent = title;
    confirmationDescription.textContent = description;
    confirmationSubmit.textContent = submitLabel;
    confirmationDialog.hidden = false;
    confirmationDialog.removeAttribute('hidden');
    if (typeof confirmationDialog.showModal === 'function') confirmationDialog.showModal();
    else confirmationDialog.setAttribute('open', '');
    (requiresPassword ? confirmationPassword.control : confirmationSubmit).focus();
  }

  function safeFailureMessage(error, fallback, password) {
    const message = error instanceof Error ? error.message : fallback;
    return password && message.includes(password) ? fallback : message;
  }

  async function submitConfirmation() {
    let password = confirmationPassword.control.value;
    const action = confirmedAction;
    confirmationPassword.control.value = '';
    confirmedAction = undefined;
    if (typeof confirmationDialog.close === 'function' && confirmationDialog.open) confirmationDialog.close();
    confirmationDialog.removeAttribute('open');
    confirmationDialog.setAttribute('hidden', '');
    confirmationDialog.hidden = true;
    try {
      if (action) await action(password);
    } finally {
      password = '';
    }
  }

  confirmationCancel.addEventListener('click', closeConfirmationDialog);
  confirmationDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeConfirmationDialog();
  });
  confirmationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitConfirmation();
  });

  function setDataActionsDisabled(disabled) {
    sellerSubmit.disabled = disabled;
    syncCommissionSubmit(disabled);
    filterSubmit.disabled = disabled;
    backupButton.disabled = disabled || state.adminBackupDownloadPending;
    syncAdministratorControls(disabled);
    syncCommissionActionControls(disabled);
    syncDefaultRuleControls(disabled);
    syncProductControls(disabled);
  }

  function syncCommissionActionControls(disabled = state.initialLoadPending) {
    csvButton.disabled = disabled || state.commissionFilterRequestPending || state.commissionCsvDownloadPending;
    markPaidButton.disabled = disabled || state.commissionFilterRequestPending || state.commissionBatchPaymentPending;
  }

  function syncAdministratorControls(disabled = state.initialLoadPending) {
    administratorSubmit.disabled = disabled || state.administratorsPending || state.administratorCreatePending;
  }

  function syncDefaultRuleControls(disabled = state.initialLoadPending) {
    const controlsDisabled = disabled || state.defaultRulePending || state.defaultRuleMutationPending;
    defaultRuleCommissionType.control.disabled = controlsDisabled;
    defaultRuleCommissionInput.control.disabled = controlsDisabled;
    defaultRuleSubmit.disabled = controlsDisabled;
  }

  function renderDefaultRule() {
    if (state.defaultRuleLoaded) {
      defaultRuleCommissionType.control.value = state.defaultRule?.commissionType ?? 'percentage';
      defaultRuleCommissionInput.control.value = state.defaultRule?.commissionInput ?? '';
    }
    syncDefaultRuleControls();
  }

  function syncProductControls(disabled = state.initialLoadPending) {
    const productActionsDisabled = disabled || state.productsPending || state.productMutationPending;
    productSubmit.disabled = productActionsDisabled;
    commissionProductId.control.disabled = disabled;
    for (const control of productActionControls) control.disabled = productActionsDisabled;
  }

  async function activateTab(name) {
    const panels = {
      resumo: summaryPanel,
      vendedores: sellersPanel,
      comissoes: commissionsPanel,
      produtos: productsPanel,
      historico: historyPanel,
      administradores: administratorsPanel,
    };
    for (const [tabName, tab] of Object.entries(tabs)) {
      const active = tabName === name;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
      panels[tabName].hidden = !active;
      if (active) panels[tabName].removeAttribute('hidden');
      else panels[tabName].setAttribute('hidden', '');
    }
    if (name === 'produtos' && !state.initialLoadPending) {
      if (!state.productsLoaded && !state.productsPending) void loadProducts();
      if (!state.defaultRuleLoaded && !state.defaultRulePending) void loadDefaultRule();
    }
    if (name === 'historico' && !state.auditEventsLoaded) await loadAuditEvents();
    if (name === 'administradores' && !state.administratorsLoaded) await loadAdministrators();
  }

  function navigateTabs(name, event) {
    const tabNames = Object.keys(tabs);
    const currentIndex = tabNames.indexOf(name);
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabNames.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabNames.length) % tabNames.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabNames.length - 1;
    else return;

    event.preventDefault();
    const nextTabName = tabNames[nextIndex];
    void activateTab(nextTabName);
    tabs[nextTabName].focus();
  }

  function resetSellerEditor() {
    state.sellerEditId = null;
    sellerFormTitle.textContent = 'Cadastrar vendedor';
    sellerPassword.label.textContent = 'Senha inicial';
    sellerPassword.control.setAttribute('required', '');
    sellerPassword.control.type = 'password';
    sellerPassword.control.checked = false;
    sellerSubmit.textContent = 'Cadastrar vendedor';
    sellerName.control.value = '';
    sellerUsername.control.value = '';
    sellerPassword.control.value = '';
    sellerPhone.control.value = '';
    clearSellerTemporaryPassword();
  }

  function beginSellerEdit(seller) {
    state.sellerEditId = seller.id;
    sellerFormTitle.textContent = 'Editar vendedor';
    sellerPassword.label.textContent = 'Gerar senha temporária';
    sellerPassword.control.removeAttribute('required');
    sellerPassword.control.type = 'checkbox';
    sellerPassword.control.checked = false;
    sellerSubmit.textContent = 'Salvar alterações';
    sellerName.control.value = seller.name ?? '';
    sellerUsername.control.value = seller.username ?? '';
    sellerPassword.control.value = '';
    sellerPhone.control.value = seller.phone ?? '';
    setFeedback(sellerFeedback);
    clearSellerTemporaryPassword();
    sellerName.control.focus();
  }

  function clearSellerRecovery() {
    sellerRecovery.replaceChildren();
  }

  function clearSellerTemporaryPassword() {
    sellerTemporaryPassword.textContent = '';
  }

  function showSellerTemporaryPassword(temporaryPassword) {
    sellerTemporaryPassword.textContent = `Senha temporária: ${temporaryPassword}`;
  }

  function offerSellerDeactivation(seller) {
    const action = createElement(document, 'button', {
      className: 'button button-secondary button-small',
      text: 'Desativar vendedor',
      attributes: { type: 'button' },
    });
    action.addEventListener('click', () => disableSeller(seller));
    sellerRecovery.replaceChildren(action);
  }

  async function requestSellerDeactivation(seller, password) {
    setFeedback(sellerFeedback);
    clearSellerRecovery();
    try {
      const disabled = await api.request(`/api/users/${encodeURIComponent(seller.id)}/disable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      state.sellers = state.sellers.map((current) => (current.id === seller.id ? disabled : current));
      renderState();
      setFeedback(sellerFeedback, 'Vendedor desativado.');
    } catch (error) {
      setFeedback(sellerFeedback, safeFailureMessage(error, 'Não foi possível desativar o vendedor.', password), 'error');
    }
  }

  function disableSeller(seller) {
    openConfirmationDialog({
      title: 'Confirmar desativação',
      description: `Informe sua senha atual para desativar ${seller.name}. Esta pessoa perderá o acesso à área de vendedor.`,
      submitLabel: 'Desativar vendedor',
      action: (password) => requestSellerDeactivation(seller, password),
    });
  }

  async function enableSeller(seller) {
    setFeedback(sellerFeedback);
    clearSellerRecovery();
    try {
      const enabled = await api.request(`/api/users/${encodeURIComponent(seller.id)}/enable`, { method: 'POST' });
      state.sellers = state.sellers.map((current) => (current.id === seller.id ? enabled : current));
      renderState();
      setFeedback(sellerFeedback, 'Vendedor reativado.');
    } catch (error) {
      setFeedback(sellerFeedback, error instanceof Error ? error.message : 'Não foi possível reativar o vendedor.', 'error');
    }
  }

  async function requestSellerDeletion(seller, password) {
    setFeedback(sellerFeedback);
    clearSellerRecovery();
    try {
      await api.request(`/api/users/${encodeURIComponent(seller.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      state.sellers = state.sellers.filter((current) => current.id !== seller.id);
      renderState();
      setFeedback(sellerFeedback, 'Vendedor excluído.');
    } catch (error) {
      setFeedback(sellerFeedback, safeFailureMessage(error, 'Não foi possível excluir o vendedor.', password), 'error');
    }
  }

  function deleteSeller(seller) {
    if (state.initialLoadPending) return;
    openConfirmationDialog({
      title: 'Confirmar exclusão',
      description: `Informe sua senha atual para excluir ${seller.name} definitivamente. Todas as comissões deste vendedor serão apagadas e a conta de acesso será removida. Esta ação não pode ser desfeita.`,
      submitLabel: 'Excluir vendedor',
      action: (password) => requestSellerDeletion(seller, password),
    });
  }

  function renderCommissionSellers() {
    const selected = commissionSeller.control.value;
    const options = [createElement(document, 'option', { text: 'Selecione um vendedor', attributes: { value: '' } })];
    for (const seller of state.sellers.filter((seller) => seller.active)) {
      const option = createElement(document, 'option', { text: seller.name, attributes: { value: seller.id } });
      option.value = seller.id;
      options.push(option);
    }
    commissionSeller.control.replaceChildren(...options);
    commissionSeller.control.value = selected;
  }

  function renderCommissionProducts() {
    const selected = state.commissionProductSelectionId;
    const options = [createElement(document, 'option', { text: 'Lançamento manual ou legado', attributes: { value: '' } })];
    for (const product of state.products.filter((product) => product.active)) {
      const option = createElement(document, 'option', { text: product.name, attributes: { value: product.id } });
      option.value = product.id;
      options.push(option);
    }
    commissionProductId.control.replaceChildren(...options);
    commissionProductId.control.value = state.products.some((product) => product.active && product.id === selected) ? selected : '';
  }

  function selectedCatalogueProduct() {
    return state.products.find((product) => product.active && product.id === state.commissionProductSelectionId) ?? null;
  }

  function syncCommissionRuleControls() {
    const product = selectedCatalogueProduct();
    const catalogueSelected = Boolean(product);
    commissionProduct.control.disabled = catalogueSelected;
    if (product) commissionProduct.control.value = product.name;
    syncCommissionSubmit();
  }

  function commissionRule() {
    const product = selectedCatalogueProduct();
    if (product) return { rule: product, source: 'produto selecionado' };
    if (state.commissionEditId && state.commissionProductSelectionId && !state.productsLoaded) return null;
    return state.defaultRule ? { rule: state.defaultRule, source: 'comissão padrão' } : null;
  }

  function syncCommissionSubmit(disabled = state.initialLoadPending) {
    commissionSubmit.disabled = disabled || !commissionRule();
  }

  function updateCommissionPreview() {
    const selection = commissionRule();
    if (!selection) {
      commissionPreview.textContent = state.commissionEditId && state.commissionProductSelectionId && !state.productsLoaded
        ? 'Carregando o produto do catálogo para esta comissão.'
        : 'Configure a comissão padrão em Produtos para lançar itens fora do catálogo.';
      return;
    }
    let value = '0.00';
    try {
      value = calculateCommissionPreview({
        saleValue: commissionSaleValue.control.value,
        commissionType: selection.rule.commissionType,
        commissionInput: selection.rule.commissionInput,
      });
    } catch {
      // Keep the empty-input preview neutral until the form is valid.
    }
    const label = selection.source === 'produto selecionado'
      ? 'Prévia do produto selecionado'
      : 'Prévia da comissão padrão';
    commissionPreview.textContent = `${label}: ${formatCurrency(value)}`;
  }

  function commissionPayload() {
    const productId = selectedCatalogueProduct()?.id;
    return {
      sellerId: commissionSeller.control.value.trim(),
      ...(productId
        ? { productId }
        : {
          ...(state.commissionEditId && state.commissionEditProductId && state.commissionProductSelectionChanged ? { productId: null } : {}),
          product: commissionProduct.control.value.trim(),
        }),
      saleValue: commissionSaleValue.control.value.trim(),
      saleDate: commissionSaleDate.control.value.trim(),
      note: commissionNote.control.value.trim(),
    };
  }

  function resetCommissionForm() {
    state.commissionEditId = null;
    state.commissionEditProductId = null;
    state.commissionProductSelectionId = '';
    state.commissionProductSelectionChanged = false;
    commissionFormTitle.textContent = 'Nova comissão';
    commissionSubmit.textContent = 'Registrar comissão';
    commissionSeller.control.value = '';
    commissionProductId.control.value = '';
    commissionProduct.control.value = '';
    commissionSaleValue.control.value = '';
    commissionSaleDate.control.value = '';
    commissionNote.control.value = '';
    syncCommissionRuleControls();
    updateCommissionPreview();
  }

  function beginCommissionEdit(commission) {
    state.commissionEditId = commission.id;
    state.commissionEditProductId = commission.productId ?? null;
    state.commissionProductSelectionId = commission.productId ?? '';
    state.commissionProductSelectionChanged = false;
    commissionFormTitle.textContent = 'Editar comissão';
    commissionSubmit.textContent = 'Salvar comissão';
    commissionSeller.control.value = commission.sellerId ?? '';
    commissionProductId.control.value = state.products.some((product) => product.active && product.id === state.commissionProductSelectionId)
      ? state.commissionProductSelectionId
      : '';
    commissionProduct.control.value = commission.product ?? '';
    commissionSaleValue.control.value = String(commission.saleValue ?? '');
    commissionSaleDate.control.value = commission.saleDate ?? '';
    commissionNote.control.value = commission.note ?? '';
    syncCommissionRuleControls();
    updateCommissionPreview();
    commissionProduct.control.focus();
  }

  async function submitCommission() {
    if (state.initialLoadPending) return;
    if (!commissionRule()) {
      setFeedback(commissionFeedback, 'Configure a comissão padrão em Produtos para lançar itens fora do catálogo.', 'error');
      updateCommissionPreview();
      return;
    }
    const payload = commissionPayload();
    const commissionId = state.commissionEditId;
    setFeedback(commissionFeedback);
    commissionSubmit.disabled = true;
    commissionSubmit.textContent = commissionId ? 'Salvando…' : 'Registrando…';
    try {
      const saved = await api.request(
        commissionId ? `/api/commissions/${encodeURIComponent(commissionId)}` : '/api/commissions',
        {
          method: commissionId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      state.commissions = commissionId
        ? state.commissions.map((commission) => (commission.id === commissionId ? saved : commission))
        : [saved, ...state.commissions];
      renderState();
      resetCommissionForm();
      if (!commissionId) checklist.complete('commission');
      setFeedback(commissionFeedback, commissionId ? 'Comissão atualizada.' : 'Comissão registrada.');
    } catch (error) {
      setFeedback(commissionFeedback, error instanceof Error ? error.message : 'Não foi possível salvar a comissão.', 'error');
    } finally {
      if (state.commissionEditId) commissionSubmit.textContent = 'Salvar comissão';
      syncCommissionSubmit();
    }
  }

  async function requestCommissionVoid(commission, password) {
    setFeedback(commissionFeedback);
    try {
      await api.request(`/api/commissions/${encodeURIComponent(commission.id)}/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      commissionSelection.delete(commission.id);
      state.commissions = state.commissions.map((current) => (
        current.id === commission.id ? { ...current, paymentStatus: 'voided' } : current
      ));
      if (state.auditEventsLoaded || state.auditEventsPending) {
        state.auditEventsGeneration += 1;
        state.auditEventsStale = true;
        setFeedback(historyFeedback, 'A comissão foi anulada. Atualize o histórico financeiro.');
      }
      renderState();
      setFeedback(commissionFeedback, 'Comissão anulada.');
    } catch (error) {
      setFeedback(commissionFeedback, safeFailureMessage(error, 'Não foi possível anular a comissão.', password), 'error');
    }
  }

  function voidCommission(commission) {
    if (state.initialLoadPending || commission.paymentStatus !== 'pending') return;
    openConfirmationDialog({
      title: 'Confirmar anulação',
      description: `Informe sua senha atual para anular a comissão de ${commission.sellerName || 'vendedor'}. O registro será preservado para auditoria.`,
      submitLabel: 'Anular comissão',
      action: (password) => requestCommissionVoid(commission, password),
    });
  }

  async function requestCommissionDeletion(commission, password) {
    setFeedback(commissionFeedback);
    try {
      await api.request(`/api/commissions/${encodeURIComponent(commission.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      commissionSelection.delete(commission.id);
      state.commissions = state.commissions.filter((current) => current.id !== commission.id);
      if (state.auditEventsLoaded || state.auditEventsPending) {
        state.auditEventsGeneration += 1;
        state.auditEventsStale = true;
        setFeedback(historyFeedback, 'A comissão foi excluída. Atualize o histórico financeiro.');
      }
      renderState();
      setFeedback(commissionFeedback, 'Comissão excluída.');
    } catch (error) {
      setFeedback(commissionFeedback, safeFailureMessage(error, 'Não foi possível excluir a comissão.', password), 'error');
    }
  }

  function deleteCommission(commission) {
    if (state.initialLoadPending) return;
    openConfirmationDialog({
      title: 'Confirmar exclusão',
      description: `Informe sua senha atual para excluir definitivamente a comissão de ${commission.sellerName || 'vendedor'}. O registro será apagado e não poderá ser recuperado.`,
      submitLabel: 'Excluir comissão',
      action: (password) => requestCommissionDeletion(commission, password),
    });
  }

  async function markSelectedCommissionsPaid() {
    if (state.initialLoadPending || state.commissionFilterRequestPending || state.commissionBatchPaymentPending) return;
    state.commissionBatchPaymentPending = true;
    syncCommissionActionControls();
    const ids = [...commissionSelection.entries()]
      .filter(([id, control]) => control.checked && state.commissions.find((commission) => commission.id === id)?.paymentStatus === 'pending')
      .map(([id]) => id);
    if (!ids.length) {
      state.commissionBatchPaymentPending = false;
      syncCommissionActionControls();
      setFeedback(commissionFeedback, 'Selecione ao menos uma comissão pendente.', 'error');
      return;
    }

    const batchFilters = { ...state.filters };
    const batchFilterGeneration = state.commissionFilterGeneration;
    setFeedback(commissionFeedback);
    markPaidButton.disabled = true;
    markPaidButton.textContent = 'Marcando como pagas…';
    try {
      const result = await api.request('/api/commissions/mark-paid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const updatedCount = Number.isInteger(result?.updatedCount) ? result.updatedCount : null;
      const paymentMessage = updatedCount === null
        ? 'Pagamento em lote concluído.'
        : `${updatedCount} comissão(ões) marcada(s) como paga(s).`;
      if (state.auditEventsLoaded || state.auditEventsPending) {
        state.auditEventsGeneration += 1;
        state.auditEventsStale = true;
        historyRefreshButton.hidden = false;
        historyRefreshButton.disabled = state.initialLoadPending || state.auditEventsPending;
        setFeedback(historyFeedback, 'O pagamento foi atualizado. Atualize o histórico financeiro.');
      }
      try {
        const refreshed = await api.request(`/api/commissions${filterQuery(batchFilters)}`);
        if (batchFilterGeneration !== state.commissionFilterGeneration) return;
        state.commissions = Array.isArray(refreshed?.items) ? refreshed.items : [];
        commissionSelection.clear();
        renderState();
        setFeedback(commissionFeedback, paymentMessage);
      } catch (error) {
        if (batchFilterGeneration !== state.commissionFilterGeneration) return;
        const refreshMessage = updatedCount === null
          ? 'O pagamento em lote foi concluído, mas não foi possível atualizar a lista.'
          : `${updatedCount} comissão(ões) marcada(s) como paga(s), mas não foi possível atualizar a lista.`;
        setFeedback(commissionFeedback, refreshMessage, 'error');
      }
    } catch (error) {
      if (batchFilterGeneration !== state.commissionFilterGeneration) return;
      setFeedback(commissionFeedback, error instanceof Error ? error.message : 'Não foi possível marcar as comissões.', 'error');
    } finally {
      state.commissionBatchPaymentPending = false;
      syncCommissionActionControls();
      markPaidButton.textContent = 'Marcar selecionadas como pagas';
    }
  }

  function currentFilters() {
    return {
      sellerId: filterSeller.control.value.trim(),
      startDate: filterStartDate.control.value.trim(),
      endDate: filterEndDate.control.value.trim(),
      paymentStatus: filterPaymentStatus.control.value.trim(),
    };
  }

  function filterQuery(filters = state.filters) {
    const search = new URLSearchParams();
    for (const key of ['sellerId', 'startDate', 'endDate', 'paymentStatus']) {
      if (filters[key]) search.set(key, filters[key]);
    }
    const query = search.toString();
    return query ? `?${query}` : '';
  }

  function renderFilterSellers({ restore = false } = {}) {
    const previous = filterSeller.control.value;
    const selected = restore ? state.filters.sellerId : (previous || state.filters.sellerId);
    const options = [createElement(document, 'option', { text: 'Todos os vendedores', attributes: { value: '' } })];
    for (const seller of state.sellers) {
      const option = createElement(document, 'option', { text: seller.name, attributes: { value: seller.id } });
      option.value = seller.id;
      options.push(option);
    }
    filterSeller.control.replaceChildren(...options);
    const available = state.sellers.some((seller) => seller.id === selected);
    filterSeller.control.value = available ? selected : '';
  }

  function renderFilters() {
    renderFilterSellers({ restore: true });
    filterStartDate.control.value = state.filters.startDate;
    filterEndDate.control.value = state.filters.endDate;
    filterPaymentStatus.control.value = state.filters.paymentStatus;
  }

  function restoreEnteredFilters(filters) {
    filterSeller.control.value = filters.sellerId;
    filterStartDate.control.value = filters.startDate;
    filterEndDate.control.value = filters.endDate;
    filterPaymentStatus.control.value = filters.paymentStatus;
  }

  function formatProductRule(product) {
    return product.commissionType === 'fixed'
      ? `Valor fixo: ${formatCurrency(product.commissionInput)}`
      : `Percentual: ${formatPercent(product.commissionInput)}`;
  }

  function resetProductEditor() {
    state.productEditId = null;
    productFormTitle.textContent = 'Cadastrar produto';
    productSubmit.textContent = 'Cadastrar produto';
    productName.control.value = '';
    productCommissionType.control.value = 'percentage';
    productCommissionInput.control.value = '';
  }

  function beginProductEdit(product) {
    if (state.productMutationPending || !product.active) return;
    state.productEditId = product.id;
    productFormTitle.textContent = 'Editar produto';
    productSubmit.textContent = 'Salvar produto';
    productName.control.value = product.name;
    productCommissionType.control.value = product.commissionType;
    productCommissionInput.control.value = String(product.commissionInput);
    setFeedback(productFeedback);
    productName.control.focus();
  }

  function productInput() {
    return {
      name: productName.control.value.trim(),
      commissionType: productCommissionType.control.value,
      commissionInput: productCommissionInput.control.value.trim(),
    };
  }

  function productRuleMayChange(product, input) {
    return product.commissionType !== input.commissionType
      || String(product.commissionInput) !== input.commissionInput;
  }

  async function loadProducts() {
    const generation = ++state.productsGeneration;
    state.productsPending = true;
    syncProductControls();
    setFeedback(productFeedback, 'Carregando catálogo de produtos.', 'loading');
    try {
      const products = await api.request('/api/products?includeInactive=true');
      if (generation !== state.productsGeneration) return;
      state.products = Array.isArray(products) ? products : [];
      state.productsLoaded = true;
      setFeedback(productFeedback);
      renderState();
      updateCommissionPreview();
    } catch (error) {
      if (generation !== state.productsGeneration) return;
      state.productsLoaded = false;
      setFeedback(productFeedback, error instanceof Error ? error.message : 'Não foi possível carregar o catálogo de produtos.', 'error');
      renderState();
    } finally {
      if (generation !== state.productsGeneration) return;
      state.productsPending = false;
      syncProductControls();
    }
  }

  async function loadDefaultRule() {
    const generation = ++state.defaultRuleGeneration;
    state.defaultRulePending = true;
    syncDefaultRuleControls();
    try {
      const rule = await api.request('/api/commission-default-rule');
      if (generation !== state.defaultRuleGeneration) return;
      state.defaultRule = rule && typeof rule === 'object' ? {
        commissionType: rule.commissionType,
        commissionInput: rule.commissionInput,
      } : null;
      state.defaultRuleLoaded = true;
      renderDefaultRule();
      syncCommissionSubmit();
      updateCommissionPreview();
    } catch {
      if (generation !== state.defaultRuleGeneration) return;
      state.defaultRuleLoaded = false;
      updateCommissionPreview();
    } finally {
      if (generation !== state.defaultRuleGeneration) return;
      state.defaultRulePending = false;
      syncDefaultRuleControls();
    }
  }

  async function saveDefaultRule() {
    if (state.initialLoadPending || state.defaultRulePending || state.defaultRuleMutationPending) return;
    const input = {
      commissionType: defaultRuleCommissionType.control.value,
      commissionInput: defaultRuleCommissionInput.control.value.trim(),
    };
    state.defaultRuleGeneration += 1;
    state.defaultRuleMutationPending = true;
    syncDefaultRuleControls();
    setFeedback(defaultRuleFeedback);
    try {
      const saved = await api.request('/api/commission-default-rule', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      state.defaultRule = {
        commissionType: saved.commissionType,
        commissionInput: saved.commissionInput,
      };
      state.defaultRuleLoaded = true;
      const recalculated = saved?.recalculatedPendingCount ?? 0;
      const successMessage = `${recalculated} comissão(ões) pendente(s) recalculada(s).`;
      renderState();
      setFeedback(defaultRuleFeedback, successMessage);
      try {
        await refreshCommissionsAfterDefaultRuleChange();
        renderState();
      } catch {
        setFeedback(defaultRuleFeedback, `${successMessage} Regra salva; não foi possível atualizar a lista de comissões.`, 'warning');
      }
    } catch (error) {
      setFeedback(defaultRuleFeedback, error instanceof Error ? error.message : 'Não foi possível salvar a comissão padrão.', 'error');
    } finally {
      state.defaultRuleMutationPending = false;
      syncDefaultRuleControls();
    }
  }

  function requestDefaultRuleSave() {
    openConfirmationDialog({
      title: 'Confirmar alteração de regra',
      description: 'As comissões pendentes sem produto cadastrado serão recalculadas. Pagas, anuladas e produtos com regra própria não serão alterados.',
      submitLabel: 'Salvar comissão padrão',
      requiresPassword: false,
      action: saveDefaultRule,
    });
  }

  async function refreshCommissionsAfterDefaultRuleChange() {
    const generation = ++state.commissionFilterGeneration;
    const result = await api.request(`/api/commissions${filterQuery()}`);
    if (generation !== state.commissionFilterGeneration) return;
    state.commissions = Array.isArray(result?.items) ? result.items : [];
  }

  async function refreshCommissionsAfterProductRuleChange() {
    const generation = ++state.commissionFilterGeneration;
    const result = await api.request(`/api/commissions${filterQuery()}`);
    if (generation !== state.commissionFilterGeneration) return;
    state.commissions = Array.isArray(result?.items) ? result.items : [];
  }

  async function saveProduct() {
    if (state.initialLoadPending || state.productsPending || state.productMutationPending) return;
    const input = productInput();
    const productId = state.productEditId;
    const current = state.products.find((product) => product.id === productId);
    const ruleChanged = Boolean(current && productRuleMayChange(current, input));
    state.productMutationPending = true;
    syncProductControls();
    setFeedback(productFeedback);
    try {
      const saved = await api.request(productId ? `/api/products/${encodeURIComponent(productId)}` : '/api/products', {
        method: productId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (ruleChanged) state.productPendingCounts.set(productId, saved?.recalculatedPendingCount ?? 0);
      await Promise.all([
        loadProducts(),
        ruleChanged ? refreshCommissionsAfterProductRuleChange() : Promise.resolve(),
      ]);
      resetProductEditor();
      if (ruleChanged) {
        const recalculated = saved?.recalculatedPendingCount ?? 0;
        setFeedback(productFeedback, `${recalculated} comissão(ões) pendente(s) recalculada(s).`);
      } else {
        setFeedback(productFeedback, productId ? 'Produto atualizado.' : 'Produto cadastrado.');
        if (!productId) checklist.complete('product');
      }
      renderState();
    } catch (error) {
      setFeedback(productFeedback, error instanceof Error ? error.message : 'Não foi possível salvar o produto.', 'error');
    } finally {
      state.productMutationPending = false;
      syncProductControls();
    }
  }

  async function setProductActive(product, active) {
    if (state.initialLoadPending || state.productsPending || state.productMutationPending) return;
    state.productMutationPending = true;
    syncProductControls();
    setFeedback(productFeedback);
    try {
      await api.request(`/api/products/${encodeURIComponent(product.id)}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' });
      await loadProducts();
      setFeedback(productFeedback, active ? 'Produto reativado.' : 'Produto desativado.');
      renderState();
    } catch (error) {
      setFeedback(productFeedback, error instanceof Error ? error.message : 'Não foi possível alterar a situação do produto.', 'error');
    } finally {
      state.productMutationPending = false;
      syncProductControls();
    }
  }

  async function removeProduct(product, password) {
    if (state.initialLoadPending || state.productsPending || state.productMutationPending) return;
    state.productMutationPending = true;
    syncProductControls();
    setFeedback(productFeedback);
    try {
      await api.request(`/api/products/${encodeURIComponent(product.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      await loadProducts();
      setFeedback(productFeedback, 'Produto excluído.');
      renderState();
    } catch (error) {
      setFeedback(productFeedback, error instanceof Error ? error.message : 'Não foi possível excluir o produto.', 'error');
    } finally {
      state.productMutationPending = false;
      syncProductControls();
    }
  }

  function deleteProduct(product) {
    if (state.initialLoadPending || state.productsPending || state.productMutationPending) return;
    openConfirmationDialog({
      title: 'Confirmar exclusão',
      description: `Informe sua senha atual para excluir o produto ${product.name}. Produtos usados por comissões não podem ser excluídos. Esta ação não pode ser desfeita.`,
      submitLabel: 'Excluir produto',
      action: (password) => removeProduct(product, password),
    });
  }

  function requestProductSave() {
    const current = state.products.find((product) => product.id === state.productEditId);
    if (current && productRuleMayChange(current, productInput())) {
      openConfirmationDialog({
        title: 'Confirmar alteração de regra',
        description: 'As comissões pendentes deste produto serão recalculadas. Pagas e anuladas não serão alteradas.',
        submitLabel: 'Alterar regra',
        requiresPassword: false,
        action: saveProduct,
      });
      return;
    }
    return saveProduct();
  }

  async function loadFilteredCommissions() {
    if (state.initialLoadPending) return;
    const filters = currentFilters();
    const filterGeneration = ++state.commissionFilterGeneration;
    state.commissionFilterRequestPending = true;
    syncCommissionActionControls();
    setFeedback(commissionFeedback);
    filterSubmit.disabled = true;
    filterSubmit.textContent = 'Filtrando…';
    try {
      const result = await api.request(`/api/commissions${filterQuery(filters)}`);
      if (filterGeneration !== state.commissionFilterGeneration) return;
      state.commissions = Array.isArray(result?.items) ? result.items : [];
      state.filters = filters;
      state.auditEventsGeneration += 1;
      if (state.auditEventsLoaded || state.auditEventsPending) {
        state.auditEventsStale = true;
        setFeedback(historyFeedback, 'Os filtros foram atualizados. Atualize o histórico financeiro.');
      }
      renderState();
      setFeedback(commissionFeedback);
    } catch (error) {
      if (filterGeneration !== state.commissionFilterGeneration) return;
      renderFilters();
      setFeedback(commissionFeedback, error instanceof Error ? error.message : 'Não foi possível filtrar as comissões.', 'error');
    } finally {
      if (filterGeneration !== state.commissionFilterGeneration) return;
      state.commissionFilterRequestPending = false;
      filterSubmit.disabled = false;
      filterSubmit.textContent = 'Aplicar filtros';
      syncCommissionActionControls();
    }
  }

  async function downloadCsv() {
    if (state.initialLoadPending || state.commissionFilterRequestPending || state.commissionCsvDownloadPending) return;
    state.commissionCsvDownloadPending = true;
    syncCommissionActionControls();
    setFeedback(commissionFeedback);
    csvButton.textContent = 'Preparando CSV…';
    try {
      const csv = await api.download(`/api/commissions/export.csv${filterQuery()}`);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      const objectUrl = globalThis.URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = 'comissoes.csv';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      releaseObjectUrl(objectUrl);
      setFeedback(commissionFeedback, 'Arquivo CSV preparado para download.');
    } catch (error) {
      setFeedback(commissionFeedback, error instanceof Error ? error.message : 'Não foi possível baixar o CSV.', 'error');
    } finally {
      state.commissionCsvDownloadPending = false;
      syncCommissionActionControls();
      csvButton.textContent = 'Baixar CSV';
    }
  }

  async function downloadAdminBackup() {
    if (state.initialLoadPending || state.adminBackupDownloadPending) return;
    state.adminBackupDownloadPending = true;
    backupButton.disabled = true;
    backupButton.textContent = 'Preparando cópia…';
    setButtonBusy(backupButton, true);
    setFeedback(backupFeedback, 'Preparando cópia administrativa.', 'loading');
    try {
      const backup = await api.download('/api/admin/backup.xlsx');
      const blob = new Blob([backup], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const link = document.createElement('a');
      const objectUrl = globalThis.URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = 'galaxy-smart-backup.xlsx';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      releaseObjectUrl(objectUrl);
      setFeedback(backupFeedback, 'Cópia administrativa preparada para download.', 'success');
    } catch (error) {
      setFeedback(backupFeedback, error instanceof Error ? error.message : 'Não foi possível baixar a cópia administrativa.', 'error');
    } finally {
      state.adminBackupDownloadPending = false;
      backupButton.disabled = state.initialLoadPending;
      backupButton.textContent = 'Baixar cópia administrativa';
      setButtonBusy(backupButton, false);
    }
  }

  function renderState() {
    const checkedCommissions = new Set(
      [...commissionSelection.entries()]
        .filter(([, control]) => control.checked)
        .map(([id]) => id),
    );
    syncDefaultRuleControls();
    renderFilterSellers();
    renderCommissionSellers();
    renderCommissionProducts();
    syncCommissionRuleControls();
    const summary = operationalSummary(state.commissions);
    sales.textContent = formatCurrency(summary.sales);
    count.textContent = String(summary.count);
    pending.textContent = formatCurrency(summary.pending);
    paid.textContent = formatCurrency(summary.paid);
    total.textContent = formatCurrency(sumCurrency(summary.pending, summary.paid));
    if (state.initialLoadPending && !state.initialLoadFailed) {
      summaryFilterStatus.textContent = 'Carregando resumo operacional.';
    } else {
      const scope = Object.values(state.filters).some(Boolean)
        ? 'Resumo dos filtros ativos.'
        : 'Resumo de todas as comissões.';
      summaryFilterStatus.textContent = state.commissions.length
        ? scope
        : `${scope} Nenhuma comissão encontrada para estes filtros.`;
    }

    const totalsRows = sellerTotals(state.sellers, state.commissions)
      .map(({ seller, pending: sellerPending, paid: sellerPaid, total: sellerTotal }, index) => {
        const row = createElement(document, 'tr');
        row.append(
          createCell(document, `${index + 1}º`, 'number-cell', { 'data-label': 'Posição' }),
          createCell(document, seller.name, '', { 'data-label': 'Vendedor' }),
          createCell(document, formatCurrency(sellerPending), 'number-cell', { 'data-label': 'A pagar' }),
          createCell(document, formatCurrency(sellerPaid), 'number-cell', { 'data-label': 'Pago' }),
          createCell(document, formatCurrency(sellerTotal), 'number-cell', { 'data-label': 'Total' }),
        );
        return row;
      });
    clearAndAppend(sellerTotalRows, state.initialLoadPending
      ? [createEmptyRow(document, state.initialLoadFailed ? 'Não foi possível carregar os vendedores. Tente novamente.' : 'Carregando vendedores.', 5)]
      : (totalsRows.length ? totalsRows : [createEmptyRow(document, 'Nenhum vendedor cadastrado.', 5)]));

    const sellerTableRows = state.sellers.map((seller) => {
      const row = createElement(document, 'tr');
      const actions = createElement(document, 'div', { className: 'table-actions' });
      const editButton = createElement(document, 'button', {
        className: 'button button-secondary button-small',
        text: 'Editar',
        attributes: { type: 'button' },
      });
      editButton.addEventListener('click', () => beginSellerEdit(seller));
      actions.append(editButton);
      if (seller.active) {
        const disableButton = createElement(document, 'button', {
          className: 'button button-secondary button-small',
          text: 'Desativar',
          attributes: { type: 'button' },
        });
        disableButton.addEventListener('click', () => disableSeller(seller));
        actions.append(disableButton);
      } else {
        const enableButton = createElement(document, 'button', {
          className: 'button button-secondary button-small',
          text: 'Ativar',
          attributes: { type: 'button' },
        });
        enableButton.addEventListener('click', () => enableSeller(seller));
        actions.append(enableButton);
      }
      const deleteButton = createElement(document, 'button', {
        className: 'button button-danger button-small',
        text: 'Excluir',
        attributes: { type: 'button' },
      });
      deleteButton.addEventListener('click', () => deleteSeller(seller));
      actions.append(deleteButton);
      row.append(
        createCell(document, seller.name, '', { 'data-label': 'Vendedor' }),
        createCell(document, seller.username || 'Não informado', '', { 'data-label': 'Usuário' }),
        createCell(document, seller.phone || 'Não informado', '', { 'data-label': 'Telefone' }),
        createCell(document, seller.active ? 'Ativo' : 'Desativado', '', { 'data-label': 'Situação' }),
        createCell(document, '', '', { 'data-label': 'Ações' }),
      );
      row.children[row.children.length - 1].append(actions);
      return row;
    });
    clearAndAppend(sellerRows, state.initialLoadPending
      ? [createEmptyRow(document, state.initialLoadFailed ? 'Não foi possível carregar os vendedores. Tente novamente.' : 'Carregando vendedores.', 5)]
      : (sellerTableRows.length ? sellerTableRows : [createEmptyRow(document, 'Nenhum vendedor cadastrado.', 5)]));

    productActionControls.clear();
    const productTableRows = state.products.map((product) => {
      const row = createElement(document, 'tr');
      const actions = createElement(document, 'div', { className: 'table-actions' });
      if (product.active) {
        const editButton = createElement(document, 'button', {
          className: 'button button-secondary button-small', text: 'Editar', attributes: { type: 'button' },
        });
        editButton.disabled = state.productMutationPending || state.productsPending;
        productActionControls.add(editButton);
        editButton.addEventListener('click', () => beginProductEdit(product));
        const deactivateButton = createElement(document, 'button', {
          className: 'button button-secondary button-small', text: 'Desativar', attributes: { type: 'button' },
        });
        deactivateButton.disabled = state.productMutationPending || state.productsPending;
        productActionControls.add(deactivateButton);
        deactivateButton.addEventListener('click', () => setProductActive(product, false));
        actions.append(editButton, deactivateButton);
      } else {
        const activateButton = createElement(document, 'button', {
          className: 'button button-secondary button-small', text: 'Reativar', attributes: { type: 'button' },
        });
        activateButton.disabled = state.productMutationPending || state.productsPending;
        productActionControls.add(activateButton);
        activateButton.addEventListener('click', () => setProductActive(product, true));
        actions.append(activateButton);
      }
      const deleteProductButton = createElement(document, 'button', {
        className: 'button button-danger button-small', text: 'Excluir', attributes: { type: 'button' },
      });
      deleteProductButton.disabled = state.productMutationPending || state.productsPending;
      productActionControls.add(deleteProductButton);
      deleteProductButton.addEventListener('click', () => deleteProduct(product));
      actions.append(deleteProductButton);
      const affected = state.productPendingCounts.has(product.id)
        ? String(state.productPendingCounts.get(product.id))
        : '—';
      row.append(
        createCell(document, product.name, '', { 'data-label': 'Produto' }),
        createCell(document, formatProductRule(product), '', { 'data-label': 'Regra' }),
        createCell(document, product.active ? 'Ativo' : 'Inativo', `product-status product-status--${product.active ? 'active' : 'inactive'}`, { 'data-label': 'Situação' }),
        createCell(document, affected, 'number-cell', { 'data-label': 'Pendências afetadas' }),
        createCell(document, '', '', { 'data-label': 'Ações' }),
      );
      row.children[4].append(actions);
      return row;
    });
    clearAndAppend(productRows, state.productsPending && !state.productsLoaded
      ? [createEmptyRow(document, 'Carregando catálogo de produtos.', 5)]
      : (productTableRows.length ? productTableRows : [createEmptyRow(document, state.productsLoaded ? 'Nenhum produto cadastrado.' : 'Não foi possível carregar o catálogo de produtos.', 5)]));

    commissionSelection.clear();
    const commissionTableRows = state.commissions.map((commission) => {
      const row = createElement(document, 'tr');
      const selection = createElement(document, 'input', {
        attributes: {
          type: 'checkbox',
          'aria-label': `Selecionar comissão de ${commission.sellerName || 'vendedor'}`,
        },
      });
      selection.type = 'checkbox';
      selection.disabled = commission.paymentStatus !== 'pending';
      if (selection.disabled) selection.checked = false;
      else if (checkedCommissions.has(commission.id)) selection.checked = true;
      commissionSelection.set(commission.id, selection);
      const actions = createElement(document, 'div', { className: 'table-actions' });
      const editButton = createElement(document, 'button', {
        className: 'button button-secondary button-small',
        text: 'Editar',
        attributes: { type: 'button' },
      });
      editButton.addEventListener('click', () => beginCommissionEdit(commission));
      actions.append(editButton);
      if (commission.paymentStatus === 'pending') {
        const voidButton = createElement(document, 'button', {
          className: 'button button-danger button-small',
          text: 'Anular comissão',
          attributes: { type: 'button' },
        });
        voidButton.addEventListener('click', () => voidCommission(commission));
        actions.append(voidButton);
      }
      const deleteCommissionButton = createElement(document, 'button', {
        className: 'button button-danger button-small',
        text: 'Excluir',
        attributes: { type: 'button' },
      });
      deleteCommissionButton.addEventListener('click', () => deleteCommission(commission));
      actions.append(deleteCommissionButton);
      row.append(
        createCell(document, '', '', { 'data-label': 'Selecionar' }),
        createCell(document, commission.sellerName || 'Não informado', '', { 'data-label': 'Vendedor' }),
        createCell(document, commission.product || 'Não informado', '', { 'data-label': 'Produto' }),
        createCell(document, formatCurrency(commission.commissionValue ?? '0.00'), 'number-cell', { 'data-label': 'Comissão' }),
        createCell(document, commission.saleDate ? formatDate(`${commission.saleDate}T12:00:00.000Z`) : 'Não informada', '', { 'data-label': 'Data' }),
        createCell(document, commission.paymentStatus === 'paid' ? 'Pago' : (commission.paymentStatus === 'voided' ? 'Anulada' : 'Pendente'), '', { 'data-label': 'Situação' }),
        createCell(document, '', '', { 'data-label': 'Ações' }),
      );
      row.children[0].append(selection);
      row.children[row.children.length - 1].append(actions);
      return row;
    });
    clearAndAppend(commissionRows, state.initialLoadPending
      ? [createEmptyRow(document, state.initialLoadFailed ? 'Não foi possível carregar as comissões. Tente novamente.' : 'Carregando comissões.', 7)]
      : (commissionTableRows.length ? commissionTableRows : [createEmptyRow(document, 'Nenhuma comissão encontrada.', 7)]));

    historyRefreshButton.hidden = !state.auditEventsStale;
    historyRefreshButton.disabled = state.initialLoadPending || state.auditEventsPending;
    const eventRows = state.auditEvents.map((event) => {
      const row = createElement(document, 'tr');
      const archivedProfile = event.eventType === 'archived';
      const archiveTarget = event.targetType === 'admin' ? 'administrador' : 'vendedor';
      const eventLabel = event.eventType === 'paid'
        ? 'Pagamento'
        : (archivedProfile ? `Arquivamento de ${archiveTarget}` : 'Anulação');
      row.append(
        createCell(document, eventLabel, '', { 'data-label': 'Evento' }),
        createCell(document, event.sellerName || event.targetName || 'Não informado', '', { 'data-label': 'Vendedor' }),
        createCell(document, event.product || (archivedProfile ? `Perfil de ${archiveTarget}` : 'Não informado'), '', { 'data-label': 'Produto' }),
        createCell(document, archivedProfile ? '—' : formatCurrency(event.commissionValue ?? '0.00'), 'number-cell', { 'data-label': 'Comissão' }),
        createCell(document, event.actorName || 'Não informado', '', { 'data-label': 'Responsável' }),
        createCell(document, event.occurredAt ? formatLocalDateTime(event.occurredAt) : 'Não informada', '', { 'data-label': 'Data e hora' }),
      );
      return row;
    });
    clearAndAppend(historyRows, state.auditEventsLoaded
      ? (eventRows.length ? eventRows : [createEmptyRow(document, 'Nenhum evento financeiro encontrado.', 6)])
      : [createEmptyRow(document, 'Selecione Histórico para carregar os eventos.', 6)]);

    const administratorTableRows = state.administrators.map((administrator) => {
      const row = createElement(document, 'tr');
      const actions = createElement(document, 'div', { className: 'table-actions' });
      if (administrator.id !== actor?.id) {
        const archiveButton = createElement(document, 'button', {
          className: 'button button-danger button-small',
          text: 'Arquivar',
          attributes: { type: 'button' },
        });
        archiveButton.addEventListener('click', () => archiveAdministrator(administrator));
        actions.append(archiveButton);
      }
      row.append(
        createCell(document, administrator.name, '', { 'data-label': 'Administrador' }),
        createCell(document, administrator.username, '', { 'data-label': 'Usuário' }),
        createCell(document, administrator.active ? 'Ativo' : 'Desativado', '', { 'data-label': 'Situação' }),
        createCell(document, '', '', { 'data-label': 'Ações' }),
      );
      row.children[row.children.length - 1].append(actions);
      return row;
    });
    clearAndAppend(administratorRows, state.administratorsPending
      ? [createEmptyRow(document, 'Carregando administradores.', 4)]
      : (state.administratorsLoaded
        ? (administratorTableRows.length ? administratorTableRows : [createEmptyRow(document, 'Nenhum administrador cadastrado.', 4)])
        : [createEmptyRow(document, 'Selecione Administradores para carregar as contas.', 4)]));
  }

  async function loadAuditEvents() {
    if (state.initialLoadPending || state.auditEventsPending) return;
    const auditEventsGeneration = state.auditEventsGeneration;
    state.auditEventsPending = true;
    historyRefreshButton.disabled = true;
    setFeedback(historyFeedback, 'Carregando histórico financeiro.', 'loading');
    try {
      const result = await api.request(`/api/audit-events${filterQuery()}`);
      if (auditEventsGeneration !== state.auditEventsGeneration) return;
      state.auditEvents = Array.isArray(result?.items) ? result.items : [];
      state.auditEventsLoaded = true;
      state.auditEventsStale = false;
      setFeedback(historyFeedback);
      renderState();
    } catch (error) {
      if (auditEventsGeneration !== state.auditEventsGeneration) return;
      setFeedback(historyFeedback, error instanceof Error ? error.message : 'Não foi possível carregar o histórico financeiro.', 'error');
    } finally {
      state.auditEventsPending = false;
      historyRefreshButton.disabled = state.initialLoadPending;
    }
  }

  async function loadAdministrators() {
    if (state.initialLoadPending || state.administratorsPending || state.administratorsLoaded) return;
    state.administratorsPending = true;
    syncAdministratorControls();
    setFeedback(administratorFeedback, 'Carregando administradores.', 'loading');
    renderState();
    try {
      const administrators = await api.request('/api/admins');
      state.administrators = Array.isArray(administrators) ? administrators : [];
      state.administratorsLoaded = true;
      setFeedback(administratorFeedback);
      renderState();
    } catch (error) {
      setFeedback(administratorFeedback, error instanceof Error ? error.message : 'Não foi possível carregar os administradores.', 'error');
    } finally {
      state.administratorsPending = false;
      syncAdministratorControls();
      renderState();
    }
  }

  async function requestAdministratorArchive(administrator, password) {
    setFeedback(administratorFeedback);
    try {
      await api.request(`/api/admins/${encodeURIComponent(administrator.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      state.administrators = state.administrators.filter((current) => current.id !== administrator.id);
      if (state.auditEventsLoaded || state.auditEventsPending) {
        state.auditEventsGeneration += 1;
        state.auditEventsStale = true;
        setFeedback(historyFeedback, 'Um administrador foi arquivado. Atualize o histórico financeiro.');
      }
      renderState();
      setFeedback(administratorFeedback, 'Administrador arquivado.');
    } catch (error) {
      setFeedback(administratorFeedback, safeFailureMessage(error, 'Não foi possível arquivar o administrador.', password), 'error');
    }
  }

  function archiveAdministrator(administrator) {
    if (administrator.id === actor?.id) return;
    openConfirmationDialog({
      title: 'Confirmar arquivamento',
      description: `Informe sua senha atual para arquivar ${administrator.name}. A conta e seu histórico serão preservados para auditoria.`,
      submitLabel: 'Arquivar administrador',
      action: (password) => requestAdministratorArchive(administrator, password),
    });
  }

  async function submitAdministrator() {
    if (state.initialLoadPending || state.administratorsPending || state.administratorCreatePending) return;
    const password = administratorPassword.control.value;
    const input = {
      name: administratorName.control.value.trim(),
      username: administratorUsername.control.value.trim(),
      password,
    };
    administratorPassword.control.value = '';
    state.administratorCreatePending = true;
    syncAdministratorControls();
    administratorSubmit.textContent = 'Cadastrando…';
    setFeedback(administratorFeedback);
    try {
      const created = await api.request('/api/admins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      state.administrators = [...state.administrators, created];
      state.administratorsLoaded = true;
      administratorName.control.value = '';
      administratorUsername.control.value = '';
      renderState();
      setFeedback(administratorFeedback, 'Administrador cadastrado.');
    } catch (error) {
      setFeedback(administratorFeedback, error instanceof Error ? error.message : 'Não foi possível cadastrar o administrador.', 'error');
    } finally {
      state.administratorCreatePending = false;
      syncAdministratorControls();
      administratorSubmit.textContent = 'Cadastrar administrador';
    }
  }

  async function loadInitialData() {
    const enteredFilters = currentFilters();
    state.initialLoadPending = true;
    state.initialLoadFailed = false;
    retryInitialLoadButton.hidden = true;
    retryInitialLoadButton.disabled = true;
    setDataActionsDisabled(true);
    setFeedback(summaryFeedback, 'Carregando dados da administração.', 'loading');
    try {
      const [sellers, commissions] = await Promise.all([
        api.request('/api/users'),
        api.request('/api/commissions'),
      ]);
      state.sellers = Array.isArray(sellers) ? sellers : [];
      state.commissions = Array.isArray(commissions?.items) ? commissions.items : [];
      state.initialLoadPending = false;
      setFeedback(summaryFeedback);
    } catch (error) {
      state.initialLoadFailed = true;
      setFeedback(summaryFeedback, error instanceof Error ? error.message : 'Não foi possível carregar a administração.', 'error');
    } finally {
      renderState();
      restoreEnteredFilters(enteredFilters);
      setDataActionsDisabled(state.initialLoadPending);
      retryInitialLoadButton.hidden = !state.initialLoadFailed;
      retryInitialLoadButton.disabled = false;
      if (!state.initialLoadPending && tabs.produtos.getAttribute('aria-selected') === 'true') {
        if (!state.productsLoaded && !state.productsPending) void loadProducts();
        if (!state.defaultRuleLoaded && !state.defaultRulePending) void loadDefaultRule();
      }
      if (!state.initialLoadPending && tabs.administradores.getAttribute('aria-selected') === 'true') {
        await loadAdministrators();
      }
      if (!state.initialLoadPending && tabs.historico.getAttribute('aria-selected') === 'true') {
        await loadAuditEvents();
      }
    }
  }

  markPaidButton.addEventListener('click', markSelectedCommissionsPaid);
  commissionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitCommission();
  });
  commissionSeller.control.addEventListener('change', updateCommissionPreview);
  commissionProductId.control.addEventListener('change', () => {
    state.commissionProductSelectionId = commissionProductId.control.value;
    state.commissionProductSelectionChanged = true;
    syncCommissionRuleControls();
    updateCommissionPreview();
  });
  commissionProductId.control.addEventListener('focus', async () => {
    if (state.initialLoadPending) return;
    const loads = [];
    if (!state.productsLoaded && !state.productsPending) loads.push(loadProducts());
    if (!state.defaultRuleLoaded && !state.defaultRulePending) loads.push(loadDefaultRule());
    await Promise.all(loads);
  });
  commissionSaleValue.control.addEventListener('input', updateCommissionPreview);

  defaultRuleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    requestDefaultRuleSave();
  });

  productForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await requestProductSave();
  });

  commissionFilterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadFilteredCommissions();
  });
  csvButton.addEventListener('click', downloadCsv);
  backupButton.addEventListener('click', downloadAdminBackup);
  retryInitialLoadButton.addEventListener('click', loadInitialData);

  sellerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.initialLoadPending) return;
    setFeedback(sellerFeedback);
    const sellerId = state.sellerEditId;
    const requestTemporaryPassword = sellerId && sellerPassword.control.checked === true;
    let passwordPayload = !sellerId && sellerPassword.control.value ? { password: sellerPassword.control.value } : null;
    const sellerInput = {
      name: sellerName.control.value.trim(),
      username: sellerUsername.control.value.trim(),
      phone: sellerPhone.control.value.trim(),
    };
    sellerPassword.control.value = '';
    sellerPassword.control.checked = false;
    sellerSubmit.disabled = true;
    sellerSubmit.textContent = sellerId ? 'Salvando…' : 'Cadastrando…';

    try {
      if (sellerId) {
        const updated = await api.request(`/api/users/${encodeURIComponent(sellerId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sellerInput),
        });
        state.sellers = state.sellers.map((seller) => (seller.id === sellerId ? updated : seller));
        renderState();
        let temporaryPassword = '';
        if (requestTemporaryPassword) {
          const reset = await api.request(`/api/users/${encodeURIComponent(sellerId)}/reset-password`, {
            method: 'POST',
          });
          temporaryPassword = reset?.temporaryPassword ?? '';
          if (!temporaryPassword) throw new Error('Não foi possível gerar a senha temporária.');
        }
        resetSellerEditor();
        if (temporaryPassword) showSellerTemporaryPassword(temporaryPassword);
        setFeedback(sellerFeedback, 'Vendedor atualizado.');
      } else {
        if (!passwordPayload) throw new Error('Informe a senha inicial do vendedor.');
        const created = await api.request('/api/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...sellerInput, ...passwordPayload }),
        });
        state.sellers = [...state.sellers, created];
        renderState();
        resetSellerEditor();
        checklist.complete('seller');
        setFeedback(sellerFeedback, 'Vendedor cadastrado.');
      }
    } catch (error) {
      setFeedback(sellerFeedback, error instanceof Error ? error.message : 'Não foi possível salvar o vendedor.', 'error');
    } finally {
      passwordPayload = null;
      sellerSubmit.disabled = false;
      if (state.sellerEditId) sellerSubmit.textContent = 'Salvar alterações';
    }
  });

  administratorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitAdministrator();
  });

  tabs.resumo.addEventListener('click', () => activateTab('resumo'));
  tabs.vendedores.addEventListener('click', () => activateTab('vendedores'));
  tabs.comissoes.addEventListener('click', () => activateTab('comissoes'));
  tabs.produtos.addEventListener('click', () => activateTab('produtos'));
  tabs.historico.addEventListener('click', () => activateTab('historico'));
  tabs.administradores.addEventListener('click', () => activateTab('administradores'));
  historyRefreshButton.addEventListener('click', loadAuditEvents);
  for (const [name, tab] of Object.entries(tabs)) {
    tab.addEventListener('keydown', (event) => navigateTabs(name, event));
  }
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      {
        icon: 'inicio',
        mockup: 'card',
        title: 'Bem-vindo à Administração de comissões',
        description: 'Vou mostrar rapidamente para que serve cada parte da tela. Clique no item destacado para avançar, use "Próximo" ou "Pular tutorial" para sair. Você pode rever depois clicando em "Ajuda".',
      },
      {
        icon: 'resumo',
        mockup: 'chart',
        target: () => tabs.resumo,
        title: 'Resumo',
        description: 'Aqui ficam os totais do período: quanto há a pagar, quanto já foi pago, o total de comissões e os totais por vendedor.',
      },
      {
        icon: 'pessoa',
        mockup: 'table',
        target: () => tabs.vendedores,
        title: 'Vendedores',
        description: 'Cadastre quem recebe comissão. Nesta aba você edita, desativa, reativa ou exclui vendedores.',
      },
      {
        icon: 'dinheiro',
        mockup: 'table',
        target: () => tabs.comissoes,
        title: 'Comissões',
        description: 'Registre vendas, veja a prévia do valor, filtre, marque comissões como pagas, anule ou exclua.',
      },
      {
        icon: 'caixa',
        mockup: 'form',
        target: () => tabs.produtos,
        title: 'Produtos',
        description: 'Defina a comissão padrão e a regra de cada produto ou serviço (percentual ou valor fixo).',
      },
      {
        icon: 'relogio',
        mockup: 'table',
        target: () => tabs.historico,
        title: 'Histórico',
        description: 'Veja o que aconteceu: pagamentos, anulações e arquivamentos, com data e responsável.',
      },
      {
        icon: 'escudo',
        mockup: 'table',
        target: () => tabs.administradores,
        title: 'Administradores',
        description: 'Cadastre outras pessoas com acesso total ou arquive quem não deve mais operar o sistema.',
      },
      {
        icon: 'ajuda',
        mockup: 'card',
        target: () => tourButton,
        title: 'Ajuda',
        description: 'Clique em "Ajuda" sempre que quiser ver este tutorial novamente.',
      },
      {
        icon: 'saida',
        mockup: 'card',
        target: () => signOutButton,
        interactive: false,
        title: 'Sair',
        description: 'Encerre a sessão ao terminar, principalmente em computadores compartilhados.',
      },
      {
        icon: 'estrela',
        mockup: 'card',
        title: 'Vamos revisar',
        description: 'Uma pergunta rápida para terminar.',
        quiz: {
          question: 'Onde você cadastra quem recebe comissão?',
          options: [
            { label: 'Na aba Produtos', correct: false },
            { label: 'Na aba Vendedores', correct: true },
            { label: 'Na aba Histórico', correct: false },
          ],
          correctMessage: 'Isso mesmo! É na aba Vendedores.',
          incorrectMessage: 'Quase! O cadastro de quem recebe comissão fica na aba Vendedores.',
        },
      },
    ],
  });
  helpMode.register(tabs.resumo, 'Mostra os totais do período e o resumo por vendedor.');
  helpMode.register(tabs.vendedores, 'Cadastre, edite, desative, reative ou exclua vendedores.');
  helpMode.register(tabs.comissoes, 'Registre vendas, filtre, marque como pagas, anule ou exclua comissões.');
  helpMode.register(tabs.produtos, 'Defina a comissão padrão e as regras de cada produto ou serviço.');
  helpMode.register(tabs.historico, 'Pagamentos, anulações e arquivamentos com data e responsável.');
  helpMode.register(tabs.administradores, 'Cadastre ou arquive administradores.');
  helpMode.register(helpMode.button, 'Liga ou desliga estas dicas nos controles.');
  helpMode.register(tourButton, 'Abre o tutorial passo a passo.');
  helpMode.register(signOutButton, 'Encerra a sessão.');
  helpMode.register(sellerName.control, 'Nome que aparece nas listas e nos relatórios.');
  helpMode.register(sellerUsername.control, 'Usuário para entrar no sistema. Sem espaços nem acentos.');
  helpMode.register(sellerPassword.control, 'Senha inicial do vendedor. Mínimo de 6 caracteres.');
  helpMode.register(sellerPhone.control, 'Telefone de contato (opcional).');
  helpMode.register(sellerSubmit, 'Cria o vendedor ou salva as alterações.');
  helpMode.register(commissionSeller.control, 'Quem fez a venda.');
  helpMode.register(commissionProductId.control, 'Produto do catálogo. A regra de comissão já vem pronta.');
  helpMode.register(commissionProduct.control, 'Nome do item quando não está no catálogo. Vale a comissão padrão.');
  helpMode.register(commissionSaleValue.control, 'Valor total da venda, em reais.');
  helpMode.register(commissionSaleDate.control, 'Data em que a venda aconteceu.');
  helpMode.register(commissionNote.control, 'Anotação livre sobre a venda (opcional).');
  helpMode.register(commissionSubmit, 'Registra ou salva a comissão.');
  helpMode.register(markPaidButton, 'Marca as comissões selecionadas como pagas.');
  helpMode.register(csvButton, 'Baixa uma planilha com as comissões filtradas.');
  helpMode.register(filterSubmit, 'Aplica os filtros escolhidos.');
  helpMode.register(defaultRuleCommissionType.control, 'Percentual sobre a venda ou valor fixo por venda.');
  helpMode.register(defaultRuleCommissionInput.control, 'Valor da comissão padrão.');
  helpMode.register(defaultRuleSubmit, 'Salva a comissão padrão.');
  helpMode.register(productName.control, 'Nome do produto ou serviço.');
  helpMode.register(productCommissionType.control, 'Percentual sobre a venda ou valor fixo por venda.');
  helpMode.register(productCommissionInput.control, 'Valor da regra deste produto.');
  helpMode.register(productSubmit, 'Cadastra o produto ou salva as alterações.');
  helpMode.register(backupButton, 'Baixa uma cópia com todos os dados.');
  helpMode.register(administratorName.control, 'Nome do novo administrador.');
  helpMode.register(administratorUsername.control, 'Usuário do novo administrador.');
  helpMode.register(administratorPassword.control, 'Senha inicial do novo administrador.');
  helpMode.register(administratorSubmit, 'Cria o administrador.');
  helpMode.register(historyRefreshButton, 'Atualiza a lista do histórico.');
  tourButton.addEventListener('click', () => tour.start());

  content.append(summaryPanel, sellersPanel, commissionsPanel, productsPanel, historyPanel, administratorsPanel);
  main.append(header, navigation, content, confirmationDialog, tour.element, helpMode.tooltip);
  root.replaceChildren(main);

  const initialLoad = loadInitialData();
  if (canAutoStartTour() && !hasSeenTour(tourStorageKey('admin'))) {
    initialLoad.then(() => tour.start()).catch(() => {});
  }

  setDataActionsDisabled(true);
  renderState();

  return {
    ready: initialLoad,
    tour,
    tourButton,
    helpMode,
    checklist,
    tabs,
    summary: { sales, pending, paid, total, count },
    summaryFilterStatus,
    sellerTotalRows,
    retryInitialLoadButton,
    retryInitialLoad: retryInitialLoadButton,
    backupButton,
    backupFeedback,
    confirmationDialog,
    confirmationDescription,
    confirmationForm,
    confirmationPassword: confirmationPassword.control,
    confirmationCancel,
    confirmationSubmit,
    sellerForm,
    sellerFields: {
      name: sellerName.control,
      username: sellerUsername.control,
      password: sellerPassword.control,
      phone: sellerPhone.control,
    },
    sellerSubmit,
    sellerFeedback,
    sellerRecovery,
    sellerTemporaryPassword,
    sellerRows,
    commissionForm,
    commissionFields: {
      sellerId: commissionSeller.control,
      productId: commissionProductId.control,
      product: commissionProduct.control,
      saleValue: commissionSaleValue.control,
      saleDate: commissionSaleDate.control,
      note: commissionNote.control,
    },
    commissionPreview,
    commissionSubmit,
    commissionSelection,
    markPaidButton,
    commissionFilterForm,
    commissionFilters: {
      sellerId: filterSeller.control,
      startDate: filterStartDate.control,
      endDate: filterEndDate.control,
      paymentStatus: filterPaymentStatus.control,
    },
    csvButton,
    commissionRows,
    productForm,
    defaultRuleForm,
    defaultRuleFields: {
      commissionType: defaultRuleCommissionType.control,
      commissionInput: defaultRuleCommissionInput.control,
    },
    defaultRuleFeedback,
    defaultRuleSubmit,
    productFields: {
      name: productName.control,
      commissionType: productCommissionType.control,
      commissionInput: productCommissionInput.control,
    },
    productFeedback,
    productRows,
    reloadProducts: loadProducts,
    reloadDefaultRule: loadDefaultRule,
    historyRows,
    historyRefreshButton,
    refreshAuditButton: historyRefreshButton,
    administratorForm,
    administratorFields: {
      name: administratorName.control,
      username: administratorUsername.control,
      password: administratorPassword.control,
    },
    administratorSubmit,
    administratorFeedback,
    administratorRows,
  };
}
