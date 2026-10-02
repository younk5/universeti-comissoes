import {
  formatCurrency, formatDate, maxCurrency, sumCurrency,
} from '../format.js';

import { canAutoStartTour, createTour, hasSeenTour, tourStorageKey } from './tour.js';
import { createHelpMode, helpStorageKey } from './help-mode.js';

function createElement(document, tagName, { className, text, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function createMetric(document, label) {
  const metric = createElement(document, 'div', { className: 'summary-metric' });
  const term = createElement(document, 'dt', { text: label });
  const detail = createElement(document, 'dd', { text: formatCurrency(0) });
  metric.append(term, detail);
  return { metric, detail };
}

function createCell(document, value, className = '', attributes = {}) {
  return createElement(document, 'td', { className, text: value, attributes });
}

function createHeaderCell(document, value) {
  return createElement(document, 'th', { text: value, attributes: { scope: 'col' } });
}

function createDateControl(document, id, label) {
  const wrapper = createElement(document, 'div', { className: 'field-group' });
  const labelElement = createElement(document, 'label', { text: label, attributes: { for: id } });
  const control = createElement(document, 'input', {
    className: 'form-control',
    attributes: { id, name: id, type: 'date' },
  });
  control.name = id;
  control.type = 'date';
  wrapper.append(labelElement, control);
  return { wrapper, control };
}

function createPasswordControl(document, id, label, autocomplete) {
  const wrapper = createElement(document, 'div', { className: 'field-group' });
  const labelElement = createElement(document, 'label', { text: label, attributes: { for: id } });
  const control = createElement(document, 'input', {
    className: 'form-control',
    attributes: { id, name: id, type: 'password', required: '', autocomplete, minlength: '6' },
  });
  control.name = id;
  control.type = 'password';
  wrapper.append(labelElement, control);
  return { wrapper, control };
}

function filterCommissionsByPeriod(commissions, { startDate, endDate }) {
  return commissions.filter((commission) => (
    (!startDate || commission.saleDate >= startDate)
    && (!endDate || commission.saleDate <= endDate)
  ));
}

function summarizeCommissions(commissions) {
  return commissions.reduce((totals, commission) => ({
    pendingTotal: commission.paymentStatus === 'pending'
      ? sumCurrency(totals.pendingTotal, commission.commissionValue)
      : totals.pendingTotal,
    paidTotal: commission.paymentStatus === 'paid'
      ? sumCurrency(totals.paidTotal, commission.commissionValue)
      : totals.paidTotal,
  }), { pendingTotal: '0.00', paidTotal: '0.00' });
}

function monthlyPaidSeries(commissions) {
  const totalsByMonth = new Map();
  for (const commission of commissions) {
    if (commission.paymentStatus !== 'paid') continue;
    const month = commission.saleDate.slice(0, 7);
    totalsByMonth.set(month, sumCurrency(totalsByMonth.get(month) ?? '0.00', commission.commissionValue));
  }
  return [...totalsByMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, total]) => ({ month, total }));
}

function formatMonth(month) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T12:00:00.000Z`));
}

function renderMonthlyBars(document, target, series) {
  if (!series.length) {
    target.replaceChildren(createElement(document, 'p', {
      className: 'seller-empty-state', text: 'Ainda não há comissões pagas no período.',
    }));
    return;
  }
  const maximum = maxCurrency(series.map((item) => item.total));
  const bars = series.map((item) => {
    const bar = createElement(document, 'div', { className: 'monthly-bar' });
    const month = formatMonth(item.month);
    const totalText = formatCurrency(item.total);
    const label = createElement(document, 'p', { className: 'monthly-bar__label', text: month });
    const meter = createElement(document, 'meter', {
      className: 'monthly-bar__meter',
      attributes: {
        min: '0',
        max: maximum,
        value: item.total,
        'aria-label': `${month}: ${totalText}`,
      },
    });
    const total = createElement(document, 'p', { className: 'monthly-bar__total', text: totalText });
    bar.append(label, meter, total);
    return bar;
  });
  target.replaceChildren(...bars);
}

function renderCommissions(document, target, commissions) {
  if (!commissions.length) {
    const row = createElement(document, 'tr', { className: 'table-empty-row' });
    row.append(createElement(document, 'td', {
      text: 'Nenhuma comissão encontrada no período.', attributes: { colspan: '5' },
    }));
    target.replaceChildren(row);
    return;
  }
  const rows = commissions.map((commission) => {
    const row = createElement(document, 'tr');
    row.append(
      createCell(document, commission.product || 'Não informado', '', { 'data-label': 'Produto' }),
      createCell(document, formatCurrency(commission.saleValue), 'number-cell', { 'data-label': 'Venda' }),
      createCell(document, formatCurrency(commission.commissionValue), 'number-cell', { 'data-label': 'Comissão' }),
      createCell(document, commission.saleDate ? formatDate(`${commission.saleDate}T12:00:00.000Z`) : 'Não informada', '', { 'data-label': 'Data' }),
      createCell(document, commission.paymentStatus === 'paid' ? 'Pago' : (commission.paymentStatus === 'voided' ? 'Anulada' : 'Pendente'), '', { 'data-label': 'Status' }),
    );
    return row;
  });
  target.replaceChildren(...rows);
}

export function renderSeller(root, { api, actor, onSignOut } = {}) {
  const document = root.ownerDocument ?? globalThis.document;
  const state = {
    wallet: null,
    commissions: [],
    period: { startDate: '', endDate: '' },
  };
  const main = createElement(document, 'main', {
    className: 'app-shell seller-shell',
    attributes: { 'aria-labelledby': 'seller-title' },
  });
  const helpMode = createHelpMode(document, { storageKey: helpStorageKey('seller'), container: main });
  const header = createElement(document, 'header', { className: 'session-header seller-header' });
  const logo = createElement(document, 'img', {
    className: 'brand-logo brand-logo--compact',
    attributes: { src: '/assets/universe-ti.svg', alt: 'Universe TI' },
  });
  const heading = createElement(document, 'div', { className: 'seller-heading' });
  const title = createElement(document, 'h1', { text: 'Minha carteira', attributes: { id: 'seller-title' } });
  const greeting = createElement(document, 'p', { text: `Olá, ${actor?.name ?? 'vendedor'}.` });
  const signOutButton = createElement(document, 'button', {
    className: 'button button-secondary', text: 'Sair', attributes: { type: 'button' },
  });
  signOutButton.addEventListener('click', onSignOut);
  const tourButton = createElement(document, 'button', {
    className: 'button button-secondary', text: 'Ajuda', attributes: { type: 'button' },
  });
  heading.append(title, greeting);
  header.append(logo, heading, helpMode.button, tourButton, signOutButton);

  const content = createElement(document, 'section', { className: 'seller-content' });
  const feedback = createElement(document, 'p', {
    className: 'form-feedback', text: 'Carregando sua carteira.', attributes: { 'aria-live': 'polite' },
  });
  const metrics = createElement(document, 'dl', { className: 'summary-metrics seller-metrics' });
  const pendingMetric = createMetric(document, 'A receber');
  const paidMetric = createMetric(document, 'Já recebido');
  metrics.append(pendingMetric.metric, paidMetric.metric);

  const periodForm = createElement(document, 'form', {
    className: 'filter-form seller-period-filter',
    attributes: { 'aria-label': 'Filtrar extrato por período' },
  });
  const startDate = createDateControl(document, 'seller-start-date', 'Data inicial');
  const endDate = createDateControl(document, 'seller-end-date', 'Data final');
  const filterSubmit = createElement(document, 'button', {
    className: 'button button-secondary', text: 'Aplicar período', attributes: { type: 'submit' },
  });
  periodForm.append(startDate.wrapper, endDate.wrapper, filterSubmit);

  const chartSection = createElement(document, 'section', {
    className: 'seller-chart', attributes: { 'aria-labelledby': 'seller-chart-title' },
  });
  const chartTitle = createElement(document, 'h2', {
    text: 'Comissões pagas por mês', attributes: { id: 'seller-chart-title' },
  });
  const monthlyBars = createElement(document, 'div', {
    className: 'monthly-bars', attributes: { 'aria-live': 'polite' },
  });
  chartSection.append(chartTitle, monthlyBars);

  const statementTitle = createElement(document, 'h2', { text: 'Extrato de comissões' });
  const table = createElement(document, 'table', { className: 'data-table seller-statement', attributes: { 'aria-label': 'Extrato de comissões' } });
  const head = createElement(document, 'thead');
  const headerRow = createElement(document, 'tr');
  headerRow.append(
    createHeaderCell(document, 'Produto'),
    createHeaderCell(document, 'Venda'),
    createHeaderCell(document, 'Comissão'),
    createHeaderCell(document, 'Data'),
    createHeaderCell(document, 'Status'),
  );
  head.append(headerRow);
  const commissionRows = createElement(document, 'tbody');
  table.append(head, commissionRows);

  const passwordSection = createElement(document, 'section', {
    className: 'seller-password-section', attributes: { 'aria-labelledby': 'seller-password-title' },
  });
  const passwordTitle = createElement(document, 'h2', {
    text: 'Alterar minha senha', attributes: { id: 'seller-password-title' },
  });
  const passwordDescription = createElement(document, 'p', {
    className: 'panel-description', text: 'Ao confirmar, você precisará entrar novamente.',
  });
  const passwordForm = createElement(document, 'form', { className: 'seller-password-form' });
  const currentPassword = createPasswordControl(document, 'seller-current-password', 'Senha atual', 'current-password');
  const newPassword = createPasswordControl(document, 'seller-new-password', 'Nova senha', 'new-password');
  const confirmation = createPasswordControl(document, 'seller-password-confirmation', 'Confirmar nova senha', 'new-password');
  const passwordFeedback = createElement(document, 'p', {
    className: 'form-feedback', attributes: { 'aria-live': 'polite' },
  });
  const passwordSubmit = createElement(document, 'button', {
    className: 'button button-primary', text: 'Alterar senha', attributes: { type: 'submit' },
  });
  passwordForm.append(
    currentPassword.wrapper,
    newPassword.wrapper,
    confirmation.wrapper,
    passwordFeedback,
    passwordSubmit,
  );
  passwordSection.append(passwordTitle, passwordDescription, passwordForm);
  content.append(feedback, metrics, periodForm, chartSection, statementTitle, table, passwordSection);

  const tour = createTour(document, {
    storageKey: tourStorageKey('seller'),
    steps: [
      {
        icon: 'inicio',
        mockup: 'card',
        title: 'Bem-vindo à sua carteira',
        description: 'Vou mostrar rapidamente onde ver o que você tem a receber e o que já recebeu. Clique no item destacado para avançar ou use "Próximo". Você pode rever depois clicando em "Ajuda".',
      },
      {
        icon: 'dinheiro',
        mockup: 'card',
        target: () => metrics,
        title: 'A receber e já recebido',
        description: 'Estes dois números mostram o total de comissões ainda não pagas e o total já pago a você.',
      },
      {
        icon: 'relogio',
        mockup: 'form',
        target: () => periodForm,
        title: 'Filtrar por período',
        description: 'Escolha uma data inicial e uma data final e clique em "Aplicar período" para ver só as comissões desse intervalo.',
      },
      {
        icon: 'resumo',
        mockup: 'chart',
        target: () => chartSection,
        title: 'Comissões pagas por mês',
        description: 'Este gráfico mostra quanto foi pago a você em cada mês.',
      },
      {
        icon: 'lista',
        mockup: 'table',
        target: () => table,
        title: 'Extrato de comissões',
        description: 'Aqui está a lista detalhada: produto, valor da venda, valor da comissão, data e situação (Pendente, Pago ou Anulada).',
      },
      {
        icon: 'chave',
        mockup: 'form',
        target: () => passwordSection,
        title: 'Alterar minha senha',
        description: 'Troque sua senha quando quiser. Depois de alterar, você precisará entrar novamente.',
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
          question: 'Onde você vê quanto ainda tem a receber?',
          options: [
            { label: 'No topo da carteira, em "A receber"', correct: true },
            { label: 'No Histórico financeiro', correct: false },
            { label: 'Na aba Produtos', correct: false },
          ],
          correctMessage: 'Isso mesmo! É o número "A receber" no topo da sua carteira.',
          incorrectMessage: 'Quase! O valor que você ainda tem a receber aparece em "A receber", no topo da carteira.',
        },
      },
    ],
  });
  helpMode.register(helpMode.button, 'Liga ou desliga estas dicas nos controles.');
  helpMode.register(tourButton, 'Abre o tutorial passo a passo.');
  helpMode.register(signOutButton, 'Encerra a sessão.');
  helpMode.register(metrics, 'Total a receber e total já recebido.');
  helpMode.register(startDate.control, 'Início do período do extrato.');
  helpMode.register(endDate.control, 'Fim do período do extrato.');
  helpMode.register(filterSubmit, 'Aplica o período escolhido.');
  helpMode.register(monthlyBars, 'Comissões pagas em cada mês.');
  helpMode.register(table, 'Lista detalhada das suas comissões.');
  helpMode.register(currentPassword.control, 'Sua senha atual.');
  helpMode.register(newPassword.control, 'A nova senha (mínimo de 6 caracteres).');
  helpMode.register(confirmation.control, 'Repita a nova senha.');
  helpMode.register(passwordSubmit, 'Confirma a troca de senha.');
  tourButton.addEventListener('click', () => tour.start());

  main.append(header, content, tour.element, helpMode.tooltip);
  root.replaceChildren(main);

  const initialLoad = load();
  if (canAutoStartTour() && !hasSeenTour(tourStorageKey('seller'))) {
    initialLoad.then(() => tour.start()).catch(() => {});
  }

  function renderWallet() {
    const hasPeriod = Boolean(state.period.startDate || state.period.endDate);
    const commissions = filterCommissionsByPeriod(state.commissions, state.period);
    const totals = hasPeriod
      ? summarizeCommissions(commissions)
      : {
        pendingTotal: state.wallet?.pendingTotal ?? '0.00',
        paidTotal: state.wallet?.paidTotal ?? '0.00',
      };
    const series = hasPeriod
      ? monthlyPaidSeries(commissions)
      : (Array.isArray(state.wallet?.monthlyPaid) ? state.wallet.monthlyPaid : monthlyPaidSeries(commissions));
    pendingMetric.detail.textContent = formatCurrency(totals.pendingTotal);
    paidMetric.detail.textContent = formatCurrency(totals.paidTotal);
    renderMonthlyBars(document, monthlyBars, series);
    renderCommissions(document, commissionRows, commissions);
  }

  async function load() {
    try {
      const wallet = await api.request('/api/wallet');
      state.wallet = wallet;
      state.commissions = Array.isArray(wallet?.commissions) ? wallet.commissions : [];
      renderWallet();
      feedback.textContent = '';
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : 'Não foi possível carregar sua carteira.';
      feedback.setAttribute('data-state', 'error');
    }
  }

  periodForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.period = { startDate: startDate.control.value, endDate: endDate.control.value };
    renderWallet();
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPasswordValue = currentPassword.control.value;
    const newPasswordValue = newPassword.control.value;
    const confirmationValue = confirmation.control.value;
    currentPassword.control.value = '';
    newPassword.control.value = '';
    confirmation.control.value = '';
    if (newPasswordValue !== confirmationValue) {
      passwordFeedback.textContent = 'A nova senha e a confirmação devem coincidir.';
      passwordFeedback.setAttribute('data-state', 'error');
      return;
    }

    passwordFeedback.textContent = '';
    passwordFeedback.removeAttribute('data-state');
    passwordSubmit.disabled = true;
    passwordSubmit.textContent = 'Alterando…';
    try {
      await api.request('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPasswordValue, newPassword: newPasswordValue }),
      });
      const message = 'Senha alterada. Entre novamente com a nova senha.';
      passwordFeedback.textContent = message;
      await onSignOut(message);
    } catch (error) {
      passwordFeedback.textContent = error instanceof Error ? error.message : 'Não foi possível alterar a senha.';
      passwordFeedback.setAttribute('data-state', 'error');
    } finally {
      passwordSubmit.disabled = false;
      passwordSubmit.textContent = 'Alterar senha';
    }
  });

  return {
    ready: initialLoad,
    tour,
    tourButton,
    helpMode,
    greeting,
    summary: { pending: pendingMetric.detail, paid: paidMetric.detail },
    periodForm,
    periodFilters: { startDate: startDate.control, endDate: endDate.control },
    monthlyBars,
    commissionRows,
    passwordForm,
    passwordFields: {
      currentPassword: currentPassword.control,
      newPassword: newPassword.control,
      confirmation: confirmation.control,
    },
    passwordFeedback,
    passwordSubmit,
  };
}
