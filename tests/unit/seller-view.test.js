import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSeller } from '../../src/client/views/seller-view.js';

function createDocument() {
  const document = {
    body: null,
    createElement(tagName) {
      const listeners = new Map();
      const attributes = new Map();
      return {
        tagName: tagName.toUpperCase(),
        ownerDocument: document,
        children: [],
        value: '',
        checked: false,
        disabled: false,
        hidden: false,
        textContent: '',
        className: '',
        dataset: {},
        append(...children) {
          this.children.push(...children);
          for (const child of children) child.parentNode = this;
        },
        appendChild(child) {
          this.append(child);
          return child;
        },
        replaceChildren(...children) {
          this.children = [];
          this.append(...children);
        },
        setAttribute(name, value) {
          attributes.set(name, String(value));
          if (name === 'hidden') this.hidden = true;
        },
        removeAttribute(name) {
          attributes.delete(name);
          if (name === 'hidden') this.hidden = false;
        },
        getAttribute(name) {
          return attributes.get(name) ?? null;
        },
        addEventListener(type, listener) {
          listeners.set(type, listener);
        },
        async dispatch(type, event = {}) {
          await listeners.get(type)?.({ preventDefault() {}, ...event });
        },
        focus() {
          this.focused = true;
        },
      };
    },
  };
  document.body = document.createElement('body');
  return document;
}

test('vendedor carrega somente a própria carteira e mostra os dados recebidos', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path) => {
      calls.push(path);
      if (path !== '/api/wallet') throw new Error(`Rota inesperada: ${path}`);
      return {
        pendingTotal: 120,
        paidTotal: 80,
        commissions: [{
          id: 'commission-1',
          sellerId: 'seller-a',
          product: 'Smartphone',
          saleValue: 800,
          commissionValue: 120,
          saleDate: '2026-09-07',
          paymentStatus: 'pending',
        }],
        monthlyPaid: [{ month: '2026-08', total: 80 }],
      };
    },
  };

  const view = renderSeller(root, {
    api,
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;

  assert.deepEqual(calls, ['/api/wallet']);
  assert.equal(view.greeting.textContent, 'Olá, Ana.');
  assert.match(view.summary.pending.textContent, /120,00/);
  assert.match(view.summary.paid.textContent, /80,00/);
  assert.equal(view.commissionRows.children.length, 1);
  assert.equal(view.commissionRows.children[0].children[0].textContent, 'Smartphone');
});

test('vendedor conserva totais exatos recebidos da carteira até formatar a moeda', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const view = renderSeller(root, {
    api: {
      request: async () => ({
        pendingTotal: '90071992547409.91',
        paidTotal: '0.00',
        commissions: [],
        monthlyPaid: [],
      }),
    },
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;

  assert.equal(view.summary.pending.textContent, 'R$ 90.071.992.547.409,91');
});

test('vendedor soma comissões filtradas como strings decimais exatas', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const view = renderSeller(root, {
    api: {
      request: async () => ({
        pendingTotal: '0.00',
        paidTotal: '0.00',
        monthlyPaid: [],
        commissions: [
          { id: 'pending-a', product: 'Venda A', saleValue: '90071992547409.91', commissionValue: '90071992547409.91', saleDate: '2026-09-01', paymentStatus: 'pending' },
          { id: 'pending-b', product: 'Venda B', saleValue: '90071992547409.91', commissionValue: '90071992547409.91', saleDate: '2026-09-02', paymentStatus: 'pending' },
        ],
      }),
    },
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;
  view.periodFilters.startDate.value = '2026-09-01';
  view.periodFilters.endDate.value = '2026-09-30';
  await view.periodForm.dispatch('submit');

  assert.equal(view.summary.pending.textContent, 'R$ 180.143.985.094.819,82');
});

test('vendedor filtra o extrato por período sem enviar identidade ou query adicional', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path) => {
      calls.push(path);
      return {
        pendingTotal: 140,
        paidTotal: 50,
        commissions: [
          { id: 'paid-aug', product: 'Plano agosto', saleValue: 500, commissionValue: 50, saleDate: '2026-08-15', paymentStatus: 'paid' },
          { id: 'pending-sep', product: 'Plano setembro', saleValue: 700, commissionValue: 140, saleDate: '2026-09-10', paymentStatus: 'pending' },
        ],
        monthlyPaid: [{ month: '2026-08', total: 50 }],
      };
    },
  };
  const view = renderSeller(root, {
    api,
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;
  view.periodFilters.startDate.value = '2026-08-01';
  view.periodFilters.endDate.value = '2026-08-31';

  await view.periodForm.dispatch('submit');

  assert.deepEqual(calls, ['/api/wallet']);
  assert.equal(view.commissionRows.children.length, 1);
  assert.equal(view.commissionRows.children[0].children[0].textContent, 'Plano agosto');
  assert.match(view.summary.paid.textContent, /50,00/);
  assert.equal(view.monthlyBars.children.length, 1);
  assert.match(view.monthlyBars.children[0].children[0].textContent, /ago\. de 2026/i);
});

test('vendedor não envia senha quando a confirmação diverge e limpa os campos sensíveis', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path) => {
      calls.push(path);
      return { pendingTotal: 0, paidTotal: 0, commissions: [], monthlyPaid: [] };
    },
  };
  const view = renderSeller(root, {
    api,
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;
  assert.deepEqual(
    Object.values(view.passwordFields).map((field) => field.getAttribute('minlength')),
    ['6', '6', '6'],
  );
  view.passwordFields.currentPassword.value = 'senha-atual-segura';
  view.passwordFields.newPassword.value = 'senha-nova-segura';
  view.passwordFields.confirmation.value = 'outra-senha-segura';

  await view.passwordForm.dispatch('submit');

  assert.deepEqual(calls, ['/api/wallet']);
  assert.equal(view.passwordFields.currentPassword.value, '');
  assert.equal(view.passwordFields.newPassword.value, '');
  assert.equal(view.passwordFields.confirmation.value, '');
  assert.equal(view.passwordFeedback.textContent, 'A nova senha e a confirmação devem coincidir.');
});

test('vendedor altera a própria senha pelo endpoint Supabase, limpa os controles e sai após a resposta 204', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const signOutMessages = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/wallet') return { pendingTotal: '0.00', paidTotal: '0.00', commissions: [], monthlyPaid: [] };
      if (path === '/api/auth/password') return undefined;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderSeller(root, {
    api,
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async (message) => signOutMessages.push(message),
  });
  await view.ready;
  view.passwordFields.currentPassword.value = 'senha-atual-segura';
  view.passwordFields.newPassword.value = 'senha-nova-segura';
  view.passwordFields.confirmation.value = 'senha-nova-segura';

  await view.passwordForm.dispatch('submit');

  assert.deepEqual(calls, [
    { path: '/api/wallet', options: {} },
    {
      path: '/api/auth/password',
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'senha-atual-segura', newPassword: 'senha-nova-segura' }),
      },
    },
  ]);
  assert.equal(view.passwordFields.currentPassword.value, '');
  assert.equal(view.passwordFields.newPassword.value, '');
  assert.equal(view.passwordFields.confirmation.value, '');
  assert.deepEqual(signOutMessages, ['Senha alterada. Entre novamente com a nova senha.']);
});

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

test('vendedor preserva totais mensais altos sem converter valores financeiros em Number', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const view = renderSeller(root, {
    api: {
      request: async () => ({
        pendingTotal: '0.00',
        paidTotal: '0.00',
        monthlyPaid: [],
        commissions: [
          { id: 'paid-a', product: 'Venda A', saleValue: '90071992547409.91', commissionValue: '90071992547409.91', saleDate: '2026-09-01', paymentStatus: 'paid' },
          { id: 'paid-b', product: 'Venda B', saleValue: '90071992547409.91', commissionValue: '90071992547409.91', saleDate: '2026-09-02', paymentStatus: 'paid' },
        ],
      }),
    },
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;
  view.periodFilters.startDate.value = '2026-09-01';
  view.periodFilters.endDate.value = '2026-09-30';
  await view.periodForm.dispatch('submit');

  const meter = view.monthlyBars.children[0].children[1];
  assert.equal(meter.getAttribute('value'), '180143985094819.82');
  assert.equal(meter.getAttribute('max'), '180143985094819.82');
});

test('vendedor mostra valores mensais pagos proporcionais sem estilos inline no gráfico', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const view = renderSeller(root, {
    api: {
      request: async () => ({
        pendingTotal: 0,
        paidTotal: 120,
        commissions: [
          { id: 'paid-jul', product: 'Plano julho', saleValue: 400, commissionValue: 40, saleDate: '2026-07-15', paymentStatus: 'paid' },
          { id: 'paid-aug', product: 'Plano agosto', saleValue: 800, commissionValue: 80, saleDate: '2026-08-15', paymentStatus: 'paid' },
        ],
        monthlyPaid: [
          { month: '2026-07', total: 40 },
          { month: '2026-08', total: 80 },
        ],
      }),
    },
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;

  const chartElements = descendants(view.monthlyBars);
  assert.equal(chartElements.some((element) => element.getAttribute('style') !== null), false);

  const meters = chartElements.filter((element) => element.tagName === 'METER');
  assert.deepEqual(meters.map((meter) => ({
    min: meter.getAttribute('min'),
    max: meter.getAttribute('max'),
    value: meter.getAttribute('value'),
  })), [
    { min: '0', max: '80.00', value: '40' },
    { min: '0', max: '80.00', value: '80' },
  ]);
  assert.match(meters[0].getAttribute('aria-label'), /40,00/);
  assert.match(meters[1].getAttribute('aria-label'), /80,00/);
});

test('vendedor recebe estados vazios úteis para gráfico e extrato', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async () => ({ pendingTotal: 0, paidTotal: 0, commissions: [], monthlyPaid: [] }),
  };
  const view = renderSeller(root, {
    api,
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;

  assert.equal(view.monthlyBars.children[0].textContent, 'Ainda não há comissões pagas no período.');
  assert.equal(view.commissionRows.children[0].children[0].textContent, 'Nenhuma comissão encontrada no período.');
});

test('vendedor preserva os rótulos do extrato para a leitura em tela pequena', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async () => ({
      pendingTotal: 0,
      paidTotal: 0,
      monthlyPaid: [],
      commissions: [{ product: 'Smartphone', saleValue: 800, commissionValue: 120, saleDate: '2026-09-07', paymentStatus: 'pending' }],
    }),
  };
  const view = renderSeller(root, {
    api,
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;

  assert.equal(view.commissionRows.children[0].children[0].getAttribute('data-label'), 'Produto');
  assert.equal(view.commissionRows.children[0].children[4].getAttribute('data-label'), 'Status');
});

test('vendedor abre o tour de ajuda pelo botão Ajuda e destaca o filtro de período', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const view = renderSeller(root, {
    api: { request: async () => ({ pendingTotal: 0, paidTotal: 0, monthlyPaid: [], commissions: [] }) },
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;

  assert.equal(view.tour.element.hidden, true);
  assert.equal(view.tour.isActive(), false);

  await view.tourButton.dispatch('click');
  assert.equal(view.tour.isActive(), true);
  assert.equal(view.tour.title.textContent, 'Bem-vindo à sua carteira');

  view.tour.next();
  assert.equal(view.tour.title.textContent, 'A receber e já recebido');

  view.tour.next();
  assert.equal(view.tour.title.textContent, 'Filtrar por período');
  assert.match(view.periodForm.className, /tour-highlight/);

  await view.tour.skipButton.dispatch('click');
  assert.equal(view.tour.isActive(), false);
  assert.equal(view.tour.element.hidden, true);
});

test('vendedor liga o modo dicas e explica a senha atual', async (t) => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });

  const document = createDocument();
  const root = document.createElement('div');
  const view = renderSeller(root, {
    api: { request: async () => ({ pendingTotal: 0, paidTotal: 0, monthlyPaid: [], commissions: [] }) },
    actor: { id: 'seller-a', name: 'Ana', role: 'seller' },
    onSignOut: async () => {},
  });
  await view.ready;

  assert.equal(view.helpMode.isEnabled(), false);
  assert.equal(view.passwordFields.currentPassword.getAttribute('data-help'), 'Sua senha atual.');

  await view.helpMode.button.dispatch('click');
  assert.equal(view.helpMode.isEnabled(), true);

  view.helpMode.handlePointerOver({ target: { closest: () => view.passwordFields.currentPassword } });
  assert.equal(view.helpMode.tooltip.hidden, false);
  assert.equal(view.helpMode.tooltip.textContent, 'Sua senha atual.');
});
