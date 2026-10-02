import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAdmin } from '../../src/client/views/admin-view.js';

const appCss = readFileSync(new URL('../../src/client/styles/app.css', import.meta.url), 'utf8');

function createDocument() {
  const document = {
    body: null,
    createElement(tagName) {
      const listeners = new Map();
      const attributes = new Map();
      const element = {
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
        remove() {
          if (!this.parentNode) return;
          this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
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
        click() {
          listeners.get('click')?.({ preventDefault() {} });
        },
        focus() {
          this.focused = true;
          document.activeElement = this;
        },
        reset() {
          for (const child of this.children) child.value = '';
        },
      };
      return element;
    },
  };
  document.body = document.createElement('body');
  return document;
}

function renderedText(element) {
  return [element.textContent, ...element.children.flatMap(renderedText)].join(' ');
}

test('admin carrega vendedores e comissões e apresenta o resumo financeiro', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path) => {
      calls.push(path);
      if (path === '/api/users') {
        return [{ id: 'seller-1', name: 'Ana', active: true }];
      }
      if (path === '/api/commissions') {
        return {
          items: [
            { id: 'pending-1', sellerId: 'seller-1', sellerName: 'Ana', commissionValue: 25, paymentStatus: 'pending', saleDate: '2026-09-07' },
            { id: 'paid-1', sellerId: 'seller-1', sellerName: 'Ana', commissionValue: 15, paymentStatus: 'paid', saleDate: '2026-09-05' },
          ],
        };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };

  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  assert.deepEqual(calls, ['/api/users', '/api/commissions']);
  assert.equal(root.children[0].tagName, 'MAIN');
  assert.equal(view.tabs.resumo.getAttribute('aria-selected'), 'true');
  assert.match(view.summary.pending.textContent, /25,00/);
  assert.match(view.summary.paid.textContent, /15,00/);
  assert.equal(view.sellerRows.children.length, 1);
  assert.equal(view.commissionRows.children.length, 2);
});

test('admin preserva agregados de comissões como strings decimais exatas', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') {
        return {
          items: [
            { id: 'pending-a', sellerId: 'seller-1', sellerName: 'Ana', commissionValue: '90071992547409.91', paymentStatus: 'pending', saleDate: '2026-09-07' },
            { id: 'pending-b', sellerId: 'seller-1', sellerName: 'Ana', commissionValue: '90071992547409.91', paymentStatus: 'pending', saleDate: '2026-09-06' },
          ],
        };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  assert.equal(view.summary.pending.textContent, 'R$ 180.143.985.094.819,82');
  assert.equal(view.summary.total.textContent, 'R$ 180.143.985.094.819,82');
});

test('admin summarizes active commissions with sales, count and ranked sellers without Number precision loss', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') {
        return [
          { id: 'seller-ana', name: 'Ana', active: true },
          { id: 'seller-bia', name: 'Bia', active: true },
        ];
      }
      if (path === '/api/commissions') {
        return {
          items: [
            { id: 'pending-ana', sellerId: 'seller-ana', sellerName: 'Ana', saleValue: '90071992547409.91', commissionValue: '90071992547409.91', paymentStatus: 'pending', saleDate: '2026-09-07' },
            { id: 'paid-bia', sellerId: 'seller-bia', sellerName: 'Bia', saleValue: '0.01', commissionValue: '0.01', paymentStatus: 'paid', saleDate: '2026-09-06' },
            { id: 'voided-bia', sellerId: 'seller-bia', sellerName: 'Bia', saleValue: '99999999999999.99', commissionValue: '99999999999999.99', paymentStatus: 'voided', saleDate: '2026-09-05' },
          ],
        };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };

  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.summary.sales.textContent, 'R$ 90.071.992.547.409,92');
  assert.equal(view.summary.count.textContent, '2');
  assert.equal(view.summary.pending.textContent, 'R$ 90.071.992.547.409,91');
  assert.equal(view.summary.paid.textContent, 'R$ 0,01');
  assert.equal(view.summary.total.textContent, 'R$ 90.071.992.547.409,92');
  assert.deepEqual(view.sellerTotalRows.children.map((row) => row.children.map((cell) => cell.textContent)), [
    ['1º', 'Ana', 'R$ 90.071.992.547.409,91', 'R$ 0,00', 'R$ 90.071.992.547.409,91'],
    ['2º', 'Bia', 'R$ 0,00', 'R$ 0,01', 'R$ 0,01'],
  ]);
});

test('admin treats an absent sale value as zero in the operational sales summary', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') {
        return {
          items: [{ id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', commissionValue: '25.00', paymentStatus: 'pending', saleDate: '2026-09-07' }],
        };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };

  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.summary.sales.textContent, 'R$ 0,00');
  assert.equal(view.summary.pending.textContent, 'R$ 25,00');
});

test('admin treats an absent public commission value as zero without crashing the summary or table', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') {
        return {
          items: [
            { id: 'pending-commission', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano pendente', saleValue: '100.00', paymentStatus: 'pending', saleDate: '2026-09-07' },
            { id: 'paid-commission', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano pago', saleValue: '50.00', paymentStatus: 'paid', saleDate: '2026-09-06' },
          ],
        };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };

  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.summary.sales.textContent, 'R$ 150,00');
  assert.equal(view.summary.pending.textContent, 'R$ 0,00');
  assert.equal(view.summary.paid.textContent, 'R$ 0,00');
  assert.equal(view.summary.total.textContent, 'R$ 0,00');
  assert.equal(view.commissionRows.children[0].children[3].textContent, 'R$ 0,00');
  assert.equal(view.commissionRows.children[1].children[3].textContent, 'R$ 0,00');
});

test('admin identifies when its operational summary represents confirmed filters with no results', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') return { items: [{ id: 'commission-1', sellerId: 'seller-1', saleValue: '100.00', commissionValue: '10.00', paymentStatus: 'pending' }] };
      if (path === '/api/commissions?sellerId=seller-1&paymentStatus=paid') return { items: [] };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  view.commissionFilters.sellerId.value = 'seller-1';
  view.commissionFilters.paymentStatus.value = 'paid';

  await view.commissionFilterForm.dispatch('submit');

  assert.equal(view.summaryFilterStatus.textContent, 'Resumo dos filtros ativos. Nenhuma comissão encontrada para estes filtros.');
});

test('admin loads financial history only when its tab is selected and carries confirmed filters', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const event = {
    id: 'event-1', eventType: 'paid', occurredAt: '2026-09-09T12:00:00.000Z',
    commissionId: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano',
    commissionValue: '12.34', actorName: 'Admin',
  };
  const api = {
    request: async (path) => {
      calls.push(path);
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/commissions?sellerId=seller-1&startDate=2026-09-01&endDate=2026-09-30&paymentStatus=paid') return { items: [] };
      if (path === '/api/audit-events?sellerId=seller-1&startDate=2026-09-01&endDate=2026-09-30&paymentStatus=paid') return { items: [event] };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(calls.some((path) => path.startsWith('/api/audit-events')), false);
  view.commissionFilters.sellerId.value = 'seller-1';
  view.commissionFilters.startDate.value = '2026-09-01';
  view.commissionFilters.endDate.value = '2026-09-30';
  view.commissionFilters.paymentStatus.value = 'paid';
  await view.commissionFilterForm.dispatch('submit');
  await view.tabs.historico.dispatch('click');

  assert.equal(calls.at(-1), '/api/audit-events?sellerId=seller-1&startDate=2026-09-01&endDate=2026-09-30&paymentStatus=paid');
  assert.deepEqual(view.historyRows.children[0].children.map((cell) => cell.textContent), [
    'Pagamento', 'Ana', 'Plano', 'R$ 12,34', 'Admin',
    new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.occurredAt)),
  ]);
});

test('admin renders missing financial history commission values as zero without feedback errors', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const event = {
    id: 'event-public-backup', eventType: 'paid', occurredAt: '2026-09-09T12:00:00.000Z',
    commissionId: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano',
    actorName: 'Admin',
  };
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/audit-events') return { items: [event] };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await assert.doesNotReject(() => view.tabs.historico.dispatch('click'));

  assert.equal(view.historyRows.children[0].children.at(3)?.textContent, 'R$ 0,00');
  const hasErrorFeedback = (element) => (
    (element.className === 'form-feedback' && element.getAttribute('data-state') === 'error')
    || element.children.some(hasErrorFeedback)
  );
  assert.equal(hasErrorFeedback(root), false);
});

test('admin invalidates cached financial history after confirmed filters and refreshes it on request', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path) => {
      calls.push(path);
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/audit-events') return { items: [{ id: 'event-all', eventType: 'paid', sellerName: 'Ana', product: 'Todas', commissionValue: '10.00', actorName: 'Admin', occurredAt: '2026-09-09T12:00:00.000Z' }] };
      if (path === '/api/commissions?sellerId=seller-1') return { items: [] };
      if (path === '/api/audit-events?sellerId=seller-1') return { items: [{ id: 'event-seller', eventType: 'voided', sellerName: 'Ana', product: 'Filtrada', commissionValue: '5.00', actorName: 'Admin', occurredAt: '2026-09-10T12:00:00.000Z' }] };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.historico.dispatch('click');
  view.commissionFilters.sellerId.value = 'seller-1';

  await view.commissionFilterForm.dispatch('submit');

  assert.equal(view.historyRefreshButton.hidden, false);
  assert.equal(view.historyRows.children[0].children[2].textContent, 'Todas');
  await view.historyRefreshButton.dispatch('click');

  assert.equal(calls.at(-1), '/api/audit-events?sellerId=seller-1');
  assert.equal(view.historyRows.children[0].children[0].textContent, 'Anulação');
  assert.equal(view.historyRows.children[0].children[2].textContent, 'Filtrada');
  assert.equal(view.historyRefreshButton.hidden, true);
});

test('admin keeps financial history stale when an older audit request resolves after confirmed filters', async () => {
  let resolveOlderAudit;
  let signalOlderAuditStarted;
  const olderAudit = new Promise((resolve) => { resolveOlderAudit = resolve; });
  const olderAuditStarted = new Promise((resolve) => { signalOlderAuditStarted = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/commissions?sellerId=seller-1') return { items: [] };
      if (path === '/api/audit-events') {
        signalOlderAuditStarted();
        return olderAudit;
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  const loadOlderAudit = view.tabs.historico.dispatch('click');
  await olderAuditStarted;
  view.commissionFilters.sellerId.value = 'seller-1';
  await view.commissionFilterForm.dispatch('submit');
  resolveOlderAudit({
    items: [{ id: 'older-event', eventType: 'paid', sellerName: 'Ana', product: 'Filtro anterior', commissionValue: '10.00', actorName: 'Admin', occurredAt: '2026-09-09T12:00:00.000Z' }],
  });
  await loadOlderAudit;

  assert.equal(view.historyRefreshButton.hidden, false);
  assert.equal(view.historyRows.children[0].children[0].textContent, 'Selecione Histórico para carregar os eventos.');
});

test('admin downloads the no-store Excel backup without exposing hidden account fields', async () => {
  const originalUrl = globalThis.URL;
  const objectUrls = [];
  globalThis.URL = {
    createObjectURL: (blob) => {
      objectUrls.push(blob);
      return 'blob:backup';
    },
    revokeObjectURL: () => {},
  };
  try {
    const document = createDocument();
    const links = [];
    const createElement = document.createElement.bind(document);
    document.createElement = (tagName) => {
      const element = createElement(tagName);
      if (tagName === 'a') element.click = () => links.push({ href: element.href, download: element.download });
      return element;
    };
    const root = document.createElement('div');
    const downloads = [];
    let resolveBackup;
    let signalBackupStarted;
    const backup = new Promise((resolve) => { resolveBackup = resolve; });
    const backupStarted = new Promise((resolve) => { signalBackupStarted = resolve; });
    const api = {
      request: async (path) => (path === '/api/users' ? [] : { items: [] }),
      download: async (path) => {
        downloads.push(path);
        signalBackupStarted();
        return backup;
      },
    };
    const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
    await view.ready;

    const download = view.backupButton.dispatch('click');
    await backupStarted;
    assert.equal(view.backupButton.disabled, true);
    resolveBackup(new Blob(['PK\u0003\u0004'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await download;

    assert.deepEqual(downloads, ['/api/admin/backup.xlsx']);
    assert.deepEqual(links, [{ href: 'blob:backup', download: 'galaxy-smart-backup.xlsx' }]);
    assert.equal(objectUrls[0].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(view.backupButton.disabled, false);
    assert.equal(view.backupFeedback.textContent, 'Cópia administrativa preparada para download.');
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('admin retries an initial load after a failure without changing entered filters', async () => {
  let sellerReads = 0;
  let commissionReads = 0;
  let resolveSellers;
  let resolveCommissions;
  const retrySellers = new Promise((resolve) => { resolveSellers = resolve; });
  const retryCommissions = new Promise((resolve) => { resolveCommissions = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') {
        sellerReads += 1;
        if (sellerReads === 1) throw new Error('Falha inicial.');
        return retrySellers;
      }
      if (path === '/api/commissions') {
        commissionReads += 1;
        return commissionReads === 1 ? { items: [] } : retryCommissions;
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.sellerSubmit.disabled, true);
  assert.equal(view.commissionForm.children.at(-1).disabled, true);
  assert.equal(view.commissionFilterForm.children[4].disabled, true);
  assert.equal(view.csvButton.disabled, true);
  assert.equal(view.markPaidButton.disabled, true);
  assert.equal(view.backupButton.disabled, true);
  assert.equal(view.retryInitialLoadButton.hidden, false);
  view.commissionFilters.sellerId.value = 'seller-1';
  view.commissionFilters.startDate.value = '2026-09-01';
  view.commissionFilters.endDate.value = '2026-09-30';
  view.commissionFilters.paymentStatus.value = 'paid';

  const retry = view.retryInitialLoadButton.dispatch('click');
  await Promise.resolve();
  assert.equal(sellerReads, 2);
  assert.equal(commissionReads, 2);
  assert.equal(view.sellerSubmit.disabled, true);
  resolveSellers([{ id: 'seller-1', name: 'Ana', active: true }]);
  await Promise.resolve();
  assert.equal(view.sellerSubmit.disabled, true);
  resolveCommissions({ items: [] });
  await retry;

  assert.equal(view.sellerSubmit.disabled, false);
  assert.equal(view.commissionSubmit.disabled, true);
  assert.equal(view.commissionFilterForm.children[4].disabled, false);
  assert.equal(view.csvButton.disabled, false);
  assert.equal(view.markPaidButton.disabled, false);
  assert.equal(view.backupButton.disabled, false);
  assert.equal(view.commissionFilters.sellerId.value, 'seller-1');
  assert.equal(view.commissionFilters.startDate.value, '2026-09-01');
  assert.equal(view.commissionFilters.endDate.value, '2026-09-30');
  assert.equal(view.commissionFilters.paymentStatus.value, 'paid');
});

test('admin bloqueia ações até a carga inicial resolver', async () => {
  let resolveSellers;
  let resolveCommissions;
  const initialSellers = new Promise((resolve) => { resolveSellers = resolve; });
  const initialCommissions = new Promise((resolve) => { resolveCommissions = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const downloads = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, method: options.method ?? 'GET' });
      if (path === '/api/users' && !options.method) return initialSellers;
      if (path === '/api/commissions' && !options.method) return initialCommissions;
      if (path.startsWith('/api/commissions?')) return { items: [] };
      if (path === '/api/users') return { id: 'seller-new', active: true };
      if (path === '/api/commissions') return { id: 'commission-new', paymentStatus: 'pending' };
      if (path === '/api/commissions/mark-paid') return { updatedCount: 0 };
      throw new Error(`Rota inesperada: ${path}`);
    },
    download: async (path) => {
      downloads.push(path);
      return 'Vendedor,Comissão\r\n';
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });

  assert.equal(view.sellerRows.children[0].children[0].textContent, 'Carregando vendedores.');
  assert.equal(view.commissionRows.children[0].children[0].textContent, 'Carregando comissões.');
  assert.equal(root.children[0].children[2].children[0].children[1].getAttribute('data-state'), 'loading');
  assert.equal(view.sellerSubmit.disabled, true);
  assert.equal(view.commissionForm.children.at(-1).disabled, true);
  assert.equal(view.commissionFilterForm.children[4].disabled, true);
  assert.equal(view.csvButton.disabled, true);
  assert.equal(view.markPaidButton.disabled, true);

  view.sellerFields.password.value = 'senha-segura-123';
  view.commissionFilters.paymentStatus.value = 'pending';
  await view.sellerForm.dispatch('submit');
  await view.commissionForm.dispatch('submit');
  await view.commissionFilterForm.dispatch('submit');
  await view.csvButton.dispatch('click');
  await view.markPaidButton.dispatch('click');

  assert.deepEqual(calls, [
    { path: '/api/users', method: 'GET' },
    { path: '/api/commissions', method: 'GET' },
  ]);
  assert.deepEqual(downloads, []);

  resolveSellers([]);
  resolveCommissions({ items: [] });
  await view.ready;

  assert.equal(view.sellerSubmit.disabled, false);
  assert.equal(view.commissionSubmit.disabled, true);
  assert.equal(view.commissionFilterForm.children[4].disabled, false);
  assert.equal(view.csvButton.disabled, false);
  assert.equal(view.markPaidButton.disabled, false);

  const failedDocument = createDocument();
  const failedRoot = failedDocument.createElement('div');
  const failedView = renderAdmin(failedRoot, {
    api: {
      request: async (path) => {
        if (path === '/api/users') throw new Error('Falha ao carregar a administração.');
        if (path === '/api/commissions') return new Promise(() => {});
        throw new Error(`Rota inesperada: ${path}`);
      },
    },
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await failedView.ready;

  assert.equal(failedView.sellerRows.children[0].children[0].textContent, 'Não foi possível carregar os vendedores. Tente novamente.');
  assert.equal(failedView.commissionRows.children[0].children[0].textContent, 'Não foi possível carregar as comissões. Tente novamente.');
  assert.equal(failedView.sellerSubmit.disabled, true);
  assert.equal(failedView.commissionForm.children.at(-1).disabled, true);
  assert.equal(failedView.commissionFilterForm.children[4].disabled, true);
  assert.equal(failedView.csvButton.disabled, true);
  assert.equal(failedView.markPaidButton.disabled, true);
  assert.equal(failedView.backupButton.disabled, true);
  assert.equal(failedView.retryInitialLoadButton.hidden, false);
  assert.equal(failedRoot.children[0].children[2].children[0].children[1].textContent, 'Falha ao carregar a administração.');
});

test('admin alterna abas reais sem deixar o painel ativo oculto', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => (path === '/api/users' ? [] : { items: [] }),
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  await view.tabs.vendedores.dispatch('click');
  const panels = root.children[0].children[2].children;

  assert.equal(view.tabs.vendedores.getAttribute('aria-selected'), 'true');
  assert.equal(view.tabs.resumo.getAttribute('aria-selected'), 'false');
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, false);
  assert.equal(panels[1].getAttribute('hidden'), null);
});

test('admin navega pelas abas com setas e ativa o painel focado', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => (path === '/api/users' ? [] : { items: [] }),
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;
  const panels = root.children[0].children[2].children;

  await view.tabs.resumo.dispatch('keydown', { key: 'ArrowRight' });

  assert.equal(view.tabs.vendedores.getAttribute('aria-selected'), 'true');
  assert.equal(view.tabs.vendedores.getAttribute('tabindex'), '0');
  assert.equal(view.tabs.vendedores.focused, true);
  assert.equal(panels[1].hidden, false);
  assert.equal(panels[0].hidden, true);

  await view.tabs.vendedores.dispatch('keydown', { key: 'ArrowLeft' });
  await view.tabs.resumo.dispatch('keydown', { key: 'ArrowLeft' });

  assert.equal(view.tabs.administradores.getAttribute('aria-selected'), 'true');
  assert.equal(view.tabs.administradores.focused, true);
  assert.equal(panels[5].hidden, false);
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, true);
});

test('admin navega pelas abas com Home e End', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => (path === '/api/users' ? [] : { items: [] }),
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;
  const panels = root.children[0].children[2].children;

  await view.tabs.resumo.dispatch('keydown', { key: 'End' });

  assert.equal(view.tabs.administradores.getAttribute('aria-selected'), 'true');
  assert.equal(view.tabs.administradores.getAttribute('tabindex'), '0');
  assert.equal(view.tabs.administradores.focused, true);
  assert.equal(panels[5].hidden, false);

  await view.tabs.administradores.dispatch('keydown', { key: 'Home' });

  assert.equal(view.tabs.resumo.getAttribute('aria-selected'), 'true');
  assert.equal(view.tabs.resumo.getAttribute('tabindex'), '0');
  assert.equal(view.tabs.resumo.focused, true);
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[5].hidden, true);
});

test('admin cria vendedor sem uma regra de comissão própria e limpa a senha imediatamente depois de montar o envio', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users' && !options.method) return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/users' && options.method === 'POST') return { id: 'seller-2', active: true };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;
  assert.equal(view.sellerFields.email, undefined);
  assert.equal(view.sellerFields.phone.getAttribute('required'), null);
  assert.equal('defaultCommissionRate' in view.sellerFields, false);
  view.sellerFields.name.value = 'Beatriz';
  view.sellerFields.username.value = 'bia';
  view.sellerFields.password.value = 'senha-segura-123';
  view.sellerFields.phone.value = '';

  await view.sellerForm.dispatch('submit');

  const createCall = calls.find((call) => call.path === '/api/users' && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(createCall.options.body), {
    name: 'Beatriz',
    username: 'bia',
    password: 'senha-segura-123',
    phone: '',
  });
  assert.equal(view.sellerFields.password.value, '');
  assert.equal(view.sellerSubmit.disabled, false);
  assert.equal(view.sellerFeedback.getAttribute('data-state'), 'success');
});

test('admin edita vendedor sem enviar regra de comissão própria ou reter senha vazia', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const seller = {
    id: 'seller-1',
    name: 'Ana',
    email: 'ana@exemplo.com',
    username: 'ana',
    phone: '11988887777',
    active: true,
  };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users' && !options.method) return [seller];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/users/seller-1' && options.method === 'PATCH') return { ...seller, name: 'Ana Souza' };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  await view.sellerRows.children[0].children[4].children[0].children[0].dispatch('click');
  assert.equal(view.sellerFields.password.value, '');
  view.sellerFields.name.value = 'Ana Souza';
  await view.sellerForm.dispatch('submit');

  const updateCall = calls.find((call) => call.path === '/api/users/seller-1' && call.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(updateCall.options.body), {
    name: 'Ana Souza',
    username: 'ana',
    phone: '11988887777',
  });
  assert.equal(calls.some((call) => call.path.includes('/reset-password')), false);
  assert.equal(view.sellerFields.password.value, '');
});

test('admin apresenta uma senha temporária uma única vez sem enviá-la de volta à API', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const seller = { id: 'seller-1', name: 'Ana', email: 'ana@exemplo.com', username: 'ana', phone: '', active: true };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users' && !options.method) return [seller];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/users/seller-1' && options.method === 'PATCH') return seller;
      if (path === '/api/users/seller-1/reset-password' && options.method === 'POST') return { temporaryPassword: 'senha-temporaria-uma-vez' };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.sellerRows.children[0].children[4].children[0].children[0].dispatch('click');
  assert.equal(view.sellerFields.password.type, 'checkbox');
  assert.equal(view.sellerFields.password.checked, false);
  view.sellerFields.password.checked = true;
  await view.sellerForm.dispatch('submit');

  const resetCall = calls.find((call) => call.path.endsWith('/reset-password'));
  assert.deepEqual(resetCall.options, { method: 'POST' });
  assert.equal(view.sellerTemporaryPassword.textContent, 'Senha temporária: senha-temporaria-uma-vez');

  await view.sellerRows.children[0].children[4].children[0].children[0].dispatch('click');
  assert.equal(view.sellerTemporaryPassword.textContent, '');
});

test('admin mantém o perfil atualizado quando a redefinição de senha falha', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const seller = {
    id: 'seller-1',
    name: 'Ana',
    email: 'ana@exemplo.com',
    username: 'ana',
    phone: '11988887777',
    active: true,
  };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users' && !options.method) return [seller];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/users/seller-1' && options.method === 'PATCH') return { ...seller, name: 'Ana Souza' };
      if (path === '/api/users/seller-1/reset-password' && options.method === 'POST') throw new Error('Não foi possível redefinir a senha.');
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.sellerRows.children[0].children[4].children[0].children[0].dispatch('click');
  view.sellerFields.name.value = 'Ana Souza';
  view.sellerFields.password.checked = true;
  await view.sellerForm.dispatch('submit');

  assert.equal(view.sellerRows.children[0].children[0].textContent, 'Ana Souza');
  assert.equal(view.sellerFeedback.textContent, 'Não foi possível redefinir a senha.');
  assert.equal(view.sellerFeedback.getAttribute('data-state'), 'error');
  assert.equal(view.sellerFields.password.value, '');
  assert.equal(calls.some((call) => call.path.endsWith('/reset-password')), true);
});

test('admin requires the confirmation dialog before deleting a seller', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const seller = { id: 'seller-1', name: 'Ana', username: 'ana', phone: '', active: true };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users' && !options.method) return [seller];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/users/seller-1' && options.method === 'DELETE') return undefined;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.sellerRows.children[0].children[4].children[0].children[2].dispatch('click');

  assert.equal(view.confirmationDialog.hidden, false);
  assert.equal(calls.some((call) => call.path === '/api/users/seller-1' && call.options.method === 'DELETE'), false);

  view.confirmationPassword.value = 'senha-atual';
  await view.confirmationForm.dispatch('submit');

  const deleteCall = calls.find((call) => call.path === '/api/users/seller-1' && call.options.method === 'DELETE');
  assert.deepEqual(JSON.parse(deleteCall.options.body), { password: 'senha-atual' });
  assert.equal(view.sellerFeedback.textContent, 'Vendedor excluído.');
  assert.equal(view.sellerRows.children[0].children[0].textContent, 'Nenhum vendedor cadastrado.');
});

test('seller deletion failure reports the error and closes the confirmation dialog', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const seller = { id: 'seller-1', name: 'Ana', username: 'ana', phone: '', active: true };
  const api = {
    request: async (path, options = {}) => {
      if (path === '/api/users' && !options.method) return [seller];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/users/seller-1' && options.method === 'DELETE') throw new Error('Falha na exclusão.');
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.sellerRows.children[0].children[4].children[0].children[2].dispatch('click');
  view.confirmationPassword.value = 'senha-atual';
  await view.confirmationForm.dispatch('submit');

  assert.equal(view.confirmationDialog.hidden, true);
  assert.equal(view.sellerFeedback.textContent, 'Falha na exclusão.');
});

test('admin exporta CSV com a mesma query dos filtros ativos', async () => {
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:comissoes', revokeObjectURL: () => {} };
  try {
    const document = createDocument();
    const root = document.createElement('div');
    const requests = [];
    const downloads = [];
    const api = {
      request: async (path) => {
        requests.push(path);
        if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
        if (path.startsWith('/api/commissions')) return { items: [] };
        throw new Error(`Rota inesperada: ${path}`);
      },
      download: async (path) => {
        downloads.push(path);
        return new Blob(['Vendedor,Comissão\r\nAna,10\r\n'], { type: 'text/csv;charset=utf-8' });
      },
    };
    const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
    await view.ready;
    view.commissionFilters.sellerId.value = 'seller-1';
    view.commissionFilters.startDate.value = '2026-09-01';
    view.commissionFilters.endDate.value = '2026-09-07';
    view.commissionFilters.paymentStatus.value = 'pending';

    await view.commissionFilterForm.dispatch('submit');
    await view.csvButton.dispatch('click');

    const expectedQuery = 'sellerId=seller-1&startDate=2026-09-01&endDate=2026-09-07&paymentStatus=pending';
    assert.equal(requests.at(-1), `/api/commissions?${expectedQuery}`);
    assert.deepEqual(downloads, [`/api/commissions/export.csv?${expectedQuery}`]);
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('admin mantém filtros confirmados quando a filtragem falha antes de baixar CSV', async () => {
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:comissoes', revokeObjectURL: () => {} };
  try {
    const document = createDocument();
    const root = document.createElement('div');
    const downloads = [];
    const api = {
      request: async (path) => {
        if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
        if (path === '/api/commissions') {
          return {
            items: [{ id: 'commission-visible', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano visível', commissionValue: 10, paymentStatus: 'pending', saleDate: '2026-09-07' }],
          };
        }
        if (path === '/api/commissions?sellerId=seller-1&paymentStatus=paid') throw new Error('Falha ao filtrar');
        throw new Error(`Rota inesperada: ${path}`);
      },
      download: async (path) => {
        downloads.push(path);
        return new Blob(['Vendedor,Comissão\r\nAna,10\r\n'], { type: 'text/csv;charset=utf-8' });
      },
    };
    const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
    await view.ready;
    view.commissionFilters.sellerId.value = 'seller-1';
    view.commissionFilters.paymentStatus.value = 'paid';

    await view.commissionFilterForm.dispatch('submit');
    await view.csvButton.dispatch('click');

    assert.equal(view.commissionRows.children[0].children[2].textContent, 'Plano visível');
    assert.equal(view.commissionFilters.sellerId.value, '');
    assert.equal(view.commissionFilters.paymentStatus.value, '');
    assert.deepEqual(downloads, ['/api/commissions/export.csv']);
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('admin bloqueia CSV enquanto um filtro mais novo está em voo', async () => {
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:comissoes', revokeObjectURL: () => {} };
  try {
    let resolveFilterB;
    let signalFilterBStarted;
    const filterBPending = new Promise((resolve) => { resolveFilterB = resolve; });
    const filterBStarted = new Promise((resolve) => { signalFilterBStarted = resolve; });
    const document = createDocument();
    const root = document.createElement('div');
    const downloads = [];
    const filterA = '/api/commissions?sellerId=seller-a&paymentStatus=pending';
    const filterB = '/api/commissions?sellerId=seller-b&paymentStatus=paid';
    const commissionA = { id: 'commission-a', sellerId: 'seller-a', sellerName: 'Ana', product: 'Pedido da Ana', commissionValue: 10, paymentStatus: 'pending', saleDate: '2026-09-07' };
    const commissionB = { id: 'commission-b', sellerId: 'seller-b', sellerName: 'Bia', product: 'Pedido da Bia', commissionValue: 20, paymentStatus: 'paid', saleDate: '2026-09-08' };
    const api = {
      request: async (path) => {
        if (path === '/api/users') {
          return [
            { id: 'seller-a', name: 'Ana', active: true },
            { id: 'seller-b', name: 'Bia', active: true },
          ];
        }
        if (path === '/api/commissions') return { items: [commissionA] };
        if (path === filterA) return { items: [commissionA] };
        if (path === filterB) {
          signalFilterBStarted();
          return filterBPending;
        }
        throw new Error(`Rota inesperada: ${path}`);
      },
      download: async (path) => {
        downloads.push(path);
        return 'Vendedor,Comissão\r\n';
      },
    };
    const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
    await view.ready;

    view.commissionFilters.sellerId.value = 'seller-a';
    view.commissionFilters.paymentStatus.value = 'pending';
    await view.commissionFilterForm.dispatch('submit');

    view.commissionFilters.sellerId.value = 'seller-b';
    view.commissionFilters.paymentStatus.value = 'paid';
    const newerFilterRequest = view.commissionFilterForm.dispatch('submit');
    await filterBStarted;
    await view.csvButton.dispatch('click');

    assert.deepEqual(
      { disabled: view.csvButton.disabled, downloads },
      { disabled: true, downloads: [] },
    );

    resolveFilterB({ items: [commissionB] });
    await newerFilterRequest;
    assert.equal(view.csvButton.disabled, false);

    await view.csvButton.dispatch('click');
    assert.deepEqual(downloads, ['/api/commissions/export.csv?sellerId=seller-b&paymentStatus=paid']);
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('admin cria comissão manual com prévia da comissão padrão e recarrega o resumo', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [] };
      if (path === '/api/commission-default-rule') return { commissionType: 'percentage', commissionInput: '10.00' };
      if (path === '/api/commissions' && options.method === 'POST') {
        return { id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', paymentStatus: 'pending', commissionValue: 25, saleDate: '2026-09-07', product: 'Smartphone' };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  assert.equal('commissionType' in view.commissionFields, false);
  assert.equal('commissionInput' in view.commissionFields, false);
  assert.doesNotMatch(renderedText(root), /Percentual padrão/);
  assert.doesNotMatch(renderedText(root), /Tipo de comissão/);
  assert.doesNotMatch(renderedText(root), /Percentual ou valor/);
  await view.commissionFields.productId.dispatch('focus');
  view.commissionFields.sellerId.value = 'seller-1';
  view.commissionFields.product.value = 'Smartphone';
  view.commissionFields.saleValue.value = '250';
  view.commissionFields.saleDate.value = '2026-09-07';
  await view.commissionFields.saleValue.dispatch('input');
  assert.match(view.commissionPreview.textContent, /comissão padrão.*25,00/i);

  await view.commissionForm.dispatch('submit');

  const createCall = calls.find((call) => call.path === '/api/commissions' && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(createCall.options.body), {
    sellerId: 'seller-1',
    product: 'Smartphone',
    saleValue: '250',
    saleDate: '2026-09-07',
    note: '',
  });
  assert.match(view.summary.pending.textContent, /25,00/);
});

test('admin mantém lançamento manual não acionável sem comissão padrão configurada', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [] };
      if (path === '/api/products?includeInactive=true') return [];
      if (path === '/api/commission-default-rule') return null;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.commissionFields.productId.dispatch('focus');
  assert.equal(view.commissionSubmit.disabled, true);
  view.commissionFields.sellerId.value = 'seller-1';
  view.commissionFields.product.value = 'Serviço avulso';
  view.commissionFields.saleValue.value = '100';
  view.commissionFields.saleDate.value = '2026-09-07';

  await view.commissionForm.dispatch('submit');

  assert.equal(calls.some((call) => call.path === '/api/commissions' && call.options.method === 'POST'), false);
  assert.equal(view.commissionPreview.textContent, 'Configure a comissão padrão em Produtos para lançar itens fora do catálogo.');
  assert.equal(view.commissionFilterForm.children.at(-1).textContent, 'Configure a comissão padrão em Produtos para lançar itens fora do catálogo.');
});

test('admin mantém valores financeiros como texto decimal exato na prévia da comissão padrão e no payload', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [] };
      if (path === '/api/commission-default-rule') return { commissionType: 'percentage', commissionInput: '10.00' };
      if (path === '/api/commissions' && options.method === 'POST') {
        return { id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', paymentStatus: 'pending', commissionValue: '9007199254740.99', saleDate: '2026-09-07', product: 'Smartphone' };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.commissionFields.productId.dispatch('focus');
  assert.equal(view.commissionSubmit.disabled, false);
  view.commissionFields.sellerId.value = 'seller-1';
  view.commissionFields.product.value = 'Smartphone';
  view.commissionFields.saleValue.value = '90071992547409.91';
  view.commissionFields.saleDate.value = '2026-09-07';
  await view.commissionFields.saleValue.dispatch('input');

  assert.equal(view.commissionPreview.textContent, 'Prévia da comissão padrão: R$ 9.007.199.254.740,99');
  await view.commissionForm.dispatch('submit');
  const createCall = calls.find((call) => call.path === '/api/commissions' && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(createCall.options.body), {
    sellerId: 'seller-1',
    product: 'Smartphone',
    saleValue: '90071992547409.91',
    saleDate: '2026-09-07',
    note: '',
  });
});

test('admin marca somente comissões pendentes selecionadas como pagas', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const commissions = [
    { id: 'pending-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano', commissionValue: 10, paymentStatus: 'pending', saleDate: '2026-09-07' },
    { id: 'paid-2', sellerId: 'seller-1', sellerName: 'Ana', product: 'Outro plano', commissionValue: 5, paymentStatus: 'paid', saleDate: '2026-09-05' },
  ];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: commissions };
      if (path === '/api/commissions/mark-paid' && options.method === 'POST') return { updatedCount: 1 };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  view.commissionSelection.get('pending-1').checked = true;

  await view.markPaidButton.dispatch('click');

  const paymentCall = calls.find((call) => call.path.endsWith('/mark-paid'));
  assert.deepEqual(JSON.parse(paymentCall.options.body), { ids: ['pending-1'] });
});

test('admin invalidates loaded financial history after batch payment', async () => {
  let commissionReads = 0;
  const document = createDocument();
  const root = document.createElement('div');
  const commission = {
    id: 'pending-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano',
    commissionValue: '10.00', paymentStatus: 'pending', saleDate: '2026-09-07',
  };
  const api = {
    request: async (path, options = {}) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) {
        commissionReads += 1;
        return { items: [{ ...commission, paymentStatus: commissionReads === 1 ? 'pending' : 'paid' }] };
      }
      if (path === '/api/audit-events') return { items: [] };
      if (path === '/api/commissions/mark-paid' && options.method === 'POST') return { updatedCount: 1 };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.historico.dispatch('click');
  view.commissionSelection.get('pending-1').checked = true;

  await view.markPaidButton.dispatch('click');

  assert.equal(view.historyRefreshButton.hidden, false);
});

test('admin ignora um segundo pagamento em lote enquanto o primeiro está em voo', async () => {
  let resolvePayment;
  let signalPaymentStarted;
  const payment = new Promise((resolve) => { resolvePayment = resolve; });
  const paymentStarted = new Promise((resolve) => { signalPaymentStarted = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const commissions = [
    { id: 'pending-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano', commissionValue: 10, paymentStatus: 'pending', saleDate: '2026-09-07' },
  ];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: commissions };
      if (path === '/api/commissions/mark-paid' && options.method === 'POST') {
        signalPaymentStarted();
        return payment;
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  view.commissionSelection.get('pending-1').checked = true;

  const firstPayment = view.markPaidButton.dispatch('click');
  await paymentStarted;
  assert.equal(view.markPaidButton.disabled, true);
  const secondPayment = view.markPaidButton.dispatch('click');

  assert.equal(calls.filter((call) => call.path === '/api/commissions/mark-paid').length, 1);

  resolvePayment({ updatedCount: 1 });
  await Promise.all([firstPayment, secondPayment]);
  assert.equal(view.markPaidButton.disabled, false);
});

test('admin recarrega o lote pago com os filtros ativos e preserva a lista se a atualização falhar', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const downloads = [];
  const selectedCommissions = [
    { id: 'pending-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Pago por outro processo', commissionValue: 10, paymentStatus: 'pending', saleDate: '2026-09-07' },
    { id: 'pending-2', sellerId: 'seller-1', sellerName: 'Ana', product: 'Ainda pendente', commissionValue: 20, paymentStatus: 'pending', saleDate: '2026-09-06' },
  ];
  const activeQuery = '/api/commissions?sellerId=seller-1&paymentStatus=pending';
  let filteredRequests = 0;
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: selectedCommissions };
      if (path === activeQuery) {
        filteredRequests += 1;
        return { items: filteredRequests === 1 ? selectedCommissions : [selectedCommissions[1]] };
      }
      if (path === '/api/commissions/mark-paid' && options.method === 'POST') return { updatedCount: 1 };
      throw new Error(`Rota inesperada: ${path}`);
    },
    download: async (path) => {
      downloads.push(path);
      return 'Vendedor,Comissão\r\n';
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  view.commissionFilters.sellerId.value = 'seller-1';
  view.commissionFilters.paymentStatus.value = 'pending';
  await view.commissionFilterForm.dispatch('submit');
  view.commissionSelection.get('pending-1').checked = true;
  view.commissionSelection.get('pending-2').checked = true;

  await view.markPaidButton.dispatch('click');

  assert.deepEqual(calls.map((call) => call.path), [
    '/api/users',
    '/api/commissions',
    activeQuery,
    '/api/commissions/mark-paid',
    activeQuery,
  ]);
  assert.equal(view.commissionRows.children.length, 1);
  assert.equal(view.commissionRows.children[0].children[2].textContent, 'Ainda pendente');
  assert.equal(view.commissionRows.children[0].children[5].textContent, 'Pendente');
  await view.csvButton.dispatch('click');
  assert.deepEqual(downloads, ['/api/commissions/export.csv?sellerId=seller-1&paymentStatus=pending']);

  const failedDocument = createDocument();
  const failedRoot = failedDocument.createElement('div');
  const failedCommission = { id: 'pending-failed-refresh', sellerId: 'seller-1', sellerName: 'Ana', product: 'Estado original', commissionValue: 30, paymentStatus: 'pending', saleDate: '2026-09-07' };
  let commissionReads = 0;
  const failedView = renderAdmin(failedRoot, {
    api: {
      request: async (path, options = {}) => {
        if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
        if (path === '/api/commissions' && !options.method) {
          commissionReads += 1;
          if (commissionReads === 1) return { items: [failedCommission] };
          throw new Error('Falha ao atualizar a lista.');
        }
        if (path === '/api/commissions/mark-paid' && options.method === 'POST') return { updatedCount: 1 };
        throw new Error(`Rota inesperada: ${path}`);
      },
    },
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await failedView.ready;
  failedView.commissionSelection.get('pending-failed-refresh').checked = true;

  await failedView.markPaidButton.dispatch('click');

  assert.equal(failedView.commissionRows.children[0].children[5].textContent, 'Pendente');
  assert.match(failedRoot.children[0].children[2].children[2].children[3].children[6].textContent, /marcada.*não foi possível atualizar/i);
  assert.equal(failedRoot.children[0].children[2].children[2].children[3].children[6].getAttribute('data-state'), 'error');
});

test('admin mantém a lista e CSV do filtro novo quando um refresh de lote obsoleto resolve por último', async () => {
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:comissoes', revokeObjectURL: () => {} };
  try {
    let resolvePayment;
    let resolveNewerFilter;
    let resolveBatchRefresh;
    let signalPaymentStarted;
    let signalNewerFilterStarted;
    let signalBatchRefreshStarted;
    const payment = new Promise((resolve) => { resolvePayment = resolve; });
    const newerFilter = new Promise((resolve) => { resolveNewerFilter = resolve; });
    const batchRefresh = new Promise((resolve) => { resolveBatchRefresh = resolve; });
    const paymentStarted = new Promise((resolve) => { signalPaymentStarted = resolve; });
    const newerFilterStarted = new Promise((resolve) => { signalNewerFilterStarted = resolve; });
    const batchRefreshStarted = new Promise((resolve) => { signalBatchRefreshStarted = resolve; });
    const document = createDocument();
    const root = document.createElement('div');
    const calls = [];
    const downloads = [];
    const filterA = '/api/commissions?sellerId=seller-a&paymentStatus=pending';
    const filterB = '/api/commissions?sellerId=seller-b&paymentStatus=paid';
    let filterAReads = 0;
    const commissionA = { id: 'commission-a', sellerId: 'seller-a', sellerName: 'Ana', product: 'Pedido da Ana', commissionValue: 10, paymentStatus: 'pending', saleDate: '2026-09-07' };
    const refreshedCommissionA = { ...commissionA, product: 'Pagamento da Ana obsoleto', paymentStatus: 'paid' };
    const commissionB = { id: 'commission-b', sellerId: 'seller-b', sellerName: 'Bia', product: 'Pedido da Bia', commissionValue: 20, paymentStatus: 'paid', saleDate: '2026-09-08' };
    const api = {
      request: async (path, options = {}) => {
        calls.push({ path, method: options.method ?? 'GET' });
        if (path === '/api/users') {
          return [
            { id: 'seller-a', name: 'Ana', active: true },
            { id: 'seller-b', name: 'Bia', active: true },
          ];
        }
        if (path === '/api/commissions' && !options.method) return { items: [commissionA] };
        if (path === filterA) {
          filterAReads += 1;
          if (filterAReads === 1) return { items: [commissionA] };
          signalBatchRefreshStarted();
          return batchRefresh;
        }
        if (path === filterB) {
          signalNewerFilterStarted();
          return newerFilter;
        }
        if (path === '/api/commissions/mark-paid' && options.method === 'POST') {
          signalPaymentStarted();
          return payment;
        }
        throw new Error(`Rota inesperada: ${path}`);
      },
      download: async (path) => {
        downloads.push(path);
        return 'Vendedor,Comissão\r\n';
      },
    };
    const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
    await view.ready;

    view.commissionFilters.sellerId.value = 'seller-a';
    view.commissionFilters.paymentStatus.value = 'pending';
    await view.commissionFilterForm.dispatch('submit');
    view.commissionSelection.get('commission-a').checked = true;

    const batchPayment = view.markPaidButton.dispatch('click');
    await paymentStarted;

    view.commissionFilters.sellerId.value = 'seller-b';
    view.commissionFilters.paymentStatus.value = 'paid';
    const newerFilterRequest = view.commissionFilterForm.dispatch('submit');
    await newerFilterStarted;

    resolvePayment({ updatedCount: 1 });
    await batchRefreshStarted;

    resolveBatchRefresh({ items: [refreshedCommissionA] });
    await batchPayment;
    assert.equal(view.markPaidButton.disabled, true);

    resolveNewerFilter({ items: [commissionB] });
    await newerFilterRequest;

    assert.deepEqual(calls.map((call) => call.path), [
      '/api/users',
      '/api/commissions',
      filterA,
      '/api/commissions/mark-paid',
      filterB,
      filterA,
    ]);
    assert.equal(view.commissionFilters.sellerId.value, 'seller-b');
    assert.equal(view.commissionFilters.paymentStatus.value, 'paid');
    assert.equal(view.commissionRows.children.length, 1);
    assert.equal(view.commissionRows.children[0].children[2].textContent, 'Pedido da Bia');
    assert.equal(root.children[0].children[2].children[2].children[3].children[6].textContent, '');

    await view.csvButton.dispatch('click');
    assert.deepEqual(downloads, ['/api/commissions/export.csv?sellerId=seller-b&paymentStatus=paid']);
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('admin não inicia pagamento em lote enquanto um filtro mais novo está em voo', async () => {
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:comissoes', revokeObjectURL: () => {} };
  try {
    let resolveNewerFilter;
    let signalNewerFilterStarted;
    const newerFilter = new Promise((resolve) => { resolveNewerFilter = resolve; });
    const newerFilterStarted = new Promise((resolve) => { signalNewerFilterStarted = resolve; });
    const document = createDocument();
    const root = document.createElement('div');
    const calls = [];
    const downloads = [];
    const filterA = '/api/commissions?sellerId=seller-a&paymentStatus=pending';
    const filterB = '/api/commissions?sellerId=seller-b&paymentStatus=paid';
    const commissionA = { id: 'commission-a', sellerId: 'seller-a', sellerName: 'Ana', product: 'Pedido da Ana', commissionValue: 10, paymentStatus: 'pending', saleDate: '2026-09-07' };
    const commissionB = { id: 'commission-b', sellerId: 'seller-b', sellerName: 'Bia', product: 'Pedido da Bia', commissionValue: 20, paymentStatus: 'paid', saleDate: '2026-09-08' };
    const api = {
      request: async (path, options = {}) => {
        calls.push({ path, method: options.method ?? 'GET' });
        if (path === '/api/users') {
          return [
            { id: 'seller-a', name: 'Ana', active: true },
            { id: 'seller-b', name: 'Bia', active: true },
          ];
        }
        if (path === '/api/commissions' && !options.method) return { items: [commissionA] };
        if (path === filterA) return { items: [commissionA] };
        if (path === filterB) {
          signalNewerFilterStarted();
          return newerFilter;
        }
        if (path === '/api/commissions/mark-paid' && options.method === 'POST') {
          throw new Error('Pagamento não deveria começar durante a filtragem.');
        }
        throw new Error(`Rota inesperada: ${path}`);
      },
      download: async (path) => {
        downloads.push(path);
        return 'Vendedor,Comissão\r\n';
      },
    };
    const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
    await view.ready;

    view.commissionFilters.sellerId.value = 'seller-a';
    view.commissionFilters.paymentStatus.value = 'pending';
    await view.commissionFilterForm.dispatch('submit');
    view.commissionSelection.get('commission-a').checked = true;

    view.commissionFilters.sellerId.value = 'seller-b';
    view.commissionFilters.paymentStatus.value = 'paid';
    const newerFilterRequest = view.commissionFilterForm.dispatch('submit');
    await newerFilterStarted;

    await view.markPaidButton.dispatch('click');

    assert.deepEqual(calls.map((call) => call.path), [
      '/api/users',
      '/api/commissions',
      filterA,
      filterB,
    ]);
    assert.equal(root.children[0].children[2].children[2].children[3].children[6].textContent, '');

    resolveNewerFilter({ items: [commissionB] });
    await newerFilterRequest;

    assert.equal(view.commissionFilters.sellerId.value, 'seller-b');
    assert.equal(view.commissionFilters.paymentStatus.value, 'paid');
    assert.equal(view.commissionRows.children.length, 1);
    assert.equal(view.commissionRows.children[0].children[2].textContent, 'Pedido da Bia');
    assert.equal(view.markPaidButton.disabled, false);

    await view.csvButton.dispatch('click');
    assert.deepEqual(downloads, ['/api/commissions/export.csv?sellerId=seller-b&paymentStatus=paid']);
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('admin edita comissão com regra de produto selecionado pelo endpoint administrativo', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Plano', commissionType: 'percentage', commissionInput: '10.00', active: true };
  const commission = { id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', productId: product.id, product: 'Plano', saleValue: '100.00', commissionValue: '10.00', paymentStatus: 'pending', saleDate: '2026-09-07', note: '' };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [commission] };
      if (path === '/api/products?includeInactive=true') return [product];
      if (path === '/api/commission-default-rule') return null;
      if (path === '/api/commissions/commission-1' && options.method === 'PATCH') return { ...commission, saleValue: '200.00' };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.commissionFields.productId.dispatch('focus');
  await view.commissionRows.children[0].children[6].children[0].children[0].dispatch('click');
  view.commissionFields.saleValue.value = '200';

  await view.commissionForm.dispatch('submit');

  const updateCall = calls.find((call) => call.path.endsWith('/commission-1') && call.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(updateCall.options.body), {
    sellerId: 'seller-1',
    productId: product.id,
    saleValue: '200',
    saleDate: '2026-09-07',
    note: '',
  });
});

test('admin preserva uma edição de comissão com produto durante a carga tardia do catálogo', async () => {
  let resolveProducts;
  let signalProductsStarted;
  const products = new Promise((resolve) => { resolveProducts = resolve; });
  const productsStarted = new Promise((resolve) => { signalProductsStarted = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Plano protegido', commissionType: 'fixed', commissionInput: '20.00', active: true };
  const commission = { id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', productId: product.id, product: product.name, saleValue: '100.00', commissionValue: '20.00', paymentStatus: 'pending', saleDate: '2026-09-07', note: '' };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [commission] };
      if (path === '/api/products?includeInactive=true') {
        signalProductsStarted();
        return products;
      }
      if (path === '/api/commission-default-rule') return { commissionType: 'percentage', commissionInput: '5.00' };
      if (path === '/api/commissions/commission-1' && options.method === 'PATCH') return commission;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.commissionRows.children[0].children[6].children[0].children[0].dispatch('click');
  const loading = view.commissionFields.productId.dispatch('focus');
  await productsStarted;
  await Promise.resolve();

  assert.equal(view.commissionSubmit.disabled, true);
  assert.equal(view.commissionPreview.textContent, 'Carregando o produto do catálogo para esta comissão.');

  resolveProducts([product]);
  await loading;

  assert.equal(view.commissionFields.productId.value, product.id);
  assert.equal(view.commissionFields.product.disabled, true);
  assert.equal(view.commissionPreview.textContent, 'Prévia do produto selecionado: R$ 20,00');
  await view.commissionForm.dispatch('submit');

  const updateCall = calls.find((call) => call.path === '/api/commissions/commission-1' && call.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(updateCall.options.body), {
    sellerId: 'seller-1',
    productId: product.id,
    saleValue: '100.00',
    saleDate: '2026-09-07',
    note: '',
  });
});

test('admin mantém a seleção manual feita durante carga tardia e envia a transição para regra padrão', async () => {
  let resolveProducts;
  let signalProductsStarted;
  const products = new Promise((resolve) => { resolveProducts = resolve; });
  const productsStarted = new Promise((resolve) => { signalProductsStarted = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Plano protegido', commissionType: 'fixed', commissionInput: '20.00', active: true };
  const commission = { id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', productId: product.id, product: product.name, saleValue: '100.00', commissionValue: '20.00', paymentStatus: 'pending', saleDate: '2026-09-07', note: '' };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [commission] };
      if (path === '/api/products?includeInactive=true') {
        signalProductsStarted();
        return products;
      }
      if (path === '/api/commission-default-rule') return { commissionType: 'percentage', commissionInput: '5.00' };
      if (path === '/api/commissions/commission-1' && options.method === 'PATCH') return { ...commission, productId: null, product: 'Consultoria manual' };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.commissionRows.children[0].children[6].children[0].children[0].dispatch('click');
  const loading = view.commissionFields.productId.dispatch('focus');
  await productsStarted;
  assert.equal(view.commissionFields.productId.disabled, false);
  view.commissionFields.productId.value = '';
  await view.commissionFields.productId.dispatch('change');
  view.commissionFields.product.value = 'Consultoria manual';
  resolveProducts([product]);
  await loading;

  assert.equal(view.commissionFields.productId.value, '');
  assert.equal(view.commissionFields.product.disabled, false);
  assert.equal(view.commissionPreview.textContent, 'Prévia da comissão padrão: R$ 5,00');
  await view.commissionForm.dispatch('submit');

  const updateCall = calls.find((call) => call.path === '/api/commissions/commission-1' && call.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(updateCall.options.body), {
    sellerId: 'seller-1',
    productId: null,
    product: 'Consultoria manual',
    saleValue: '100.00',
    saleDate: '2026-09-07',
    note: '',
  });
});

test('admin requires the confirmation dialog before voiding a pending commission', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const commission = { id: 'commission-pending', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano pendente', commissionValue: '10.00', paymentStatus: 'pending', saleDate: '2026-09-07' };
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [commission] };
      if (path === '/api/commissions/commission-pending/void' && options.method === 'POST') return undefined;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.commissionRows.children[0].children[6].children[0].children[1].dispatch('click');
  assert.equal(calls.some((call) => call.path === '/api/commissions/commission-pending/void'), false);

  view.confirmationPassword.value = 'senha-atual';
  await view.confirmationForm.dispatch('submit');

  const voidCall = calls.find((call) => call.path === '/api/commissions/commission-pending/void' && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(voidCall.options.body), { password: 'senha-atual' });
  assert.equal(view.commissionRows.children[0].children[5].textContent, 'Anulada');
});

test('admin invalidates loaded financial history after voiding a commission', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const commission = {
    id: 'pending-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano',
    commissionValue: '10.00', paymentStatus: 'pending', saleDate: '2026-09-07',
  };
  const api = {
    request: async (path, options = {}) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [commission] };
      if (path === '/api/audit-events') return { items: [] };
      if (path === '/api/commissions/pending-1/void' && options.method === 'POST') return undefined;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.historico.dispatch('click');

  await view.commissionRows.children[0].children[6].children[0].children[1].dispatch('click');
  view.confirmationPassword.value = 'senha-atual';
  await view.confirmationForm.dispatch('submit');

  assert.equal(view.historyRefreshButton.hidden, false);
});

test('admin gives the Administradores tab enough width on narrow screens', () => {
  assert.match(
    appCss,
    /@media\s*\(max-width:\s*560px\)\s*\{\s*\.admin-shell[\s\S]*?\.admin-tabs\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
  );
  assert.match(
    appCss,
    /@media\s*\(max-width:\s*370px\)\s*\{\s*\.admin-tabs\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
  );
});

test('admin annotates mobile table cells and exposes Portuguese operational controls', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') {
        return [{
          id: 'seller-1', name: 'Ana', username: 'ana', phone: '11999999999',
          active: true,
        }];
      }
      if (path === '/api/commissions') {
        return {
          items: [{
            id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano',
            commissionValue: '10.00', paymentStatus: 'pending', saleDate: '2026-09-07',
          }],
        };
      }
      if (path === '/api/audit-events') {
        return {
          items: [{
            id: 'event-1', eventType: 'paid', sellerName: 'Ana', product: 'Plano',
            commissionValue: '10.00', actorName: 'Admin', occurredAt: '2026-09-09T12:00:00.000Z',
          }],
        };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };

  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  assert.deepEqual(
    view.sellerTotalRows.children[0].children.map((cell) => cell.getAttribute('data-label')),
    ['Posição', 'Vendedor', 'A pagar', 'Pago', 'Total'],
  );
  assert.deepEqual(
    view.sellerRows.children[0].children.map((cell) => cell.getAttribute('data-label')),
    ['Vendedor', 'Usuário', 'Telefone', 'Situação', 'Ações'],
  );
  assert.deepEqual(
    view.commissionRows.children[0].children.map((cell) => cell.getAttribute('data-label')),
    ['Selecionar', 'Vendedor', 'Produto', 'Comissão', 'Data', 'Situação', 'Ações'],
  );
  assert.equal(view.historyRows.children[0].children[0].getAttribute('data-label'), null);

  await view.tabs.historico.dispatch('click');

  assert.deepEqual(
    view.historyRows.children[0].children.map((cell) => cell.getAttribute('data-label')),
    ['Evento', 'Vendedor', 'Produto', 'Comissão', 'Responsável', 'Data e hora'],
  );
  assert.equal(view.retryInitialLoad.textContent, 'Tentar novamente');
  assert.equal(view.backupButton.textContent, 'Baixar cópia administrativa');
  assert.equal(view.refreshAuditButton.textContent, 'Atualizar histórico');
});

test('admin identifies backup loading and success feedback for assistive operation', async () => {
  let resolveBackup;
  const backup = new Promise((resolve) => { resolveBackup = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => (path === '/api/users' ? [] : { items: [] }),
    download: async () => backup,
  };
  const originalUrl = globalThis.URL;
  globalThis.URL = {
    createObjectURL: () => 'blob:backup',
    revokeObjectURL: () => {},
  };
  try {
    const view = renderAdmin(root, {
      api,
      actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
      onSignOut: () => {},
    });
    await view.ready;

    const download = view.backupButton.dispatch('click');
    await Promise.resolve();

    assert.equal(view.backupButton.getAttribute('aria-busy'), 'true');
    assert.equal(view.backupFeedback.getAttribute('data-state'), 'loading');

    resolveBackup(new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await download;

    assert.equal(view.backupButton.getAttribute('aria-busy'), 'false');
    assert.equal(view.backupFeedback.getAttribute('data-state'), 'success');
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('admin identifies financial history loading feedback before audit data resolves', async () => {
  let resolveAudit;
  const audit = new Promise((resolve) => { resolveAudit = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/audit-events') return audit;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  const loading = view.tabs.historico.dispatch('click');
  await Promise.resolve();

  assert.equal(root.children[0].children[2].children[4].children[1].getAttribute('data-state'), 'loading');

  resolveAudit({ items: [] });
  await loading;
});

test('admin creates and lists administrators without browser role or contact fields', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/admins' && !options.method) {
        return [{ id: 'admin-2', name: 'Bia Admin', username: 'bia.admin', active: true }];
      }
      if (path === '/api/admins' && options.method === 'POST') {
        return { id: 'admin-3', name: 'Caio Admin', username: 'caio.admin', active: true };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  assert.deepEqual(
    [view.sellerFields.password, view.administratorFields.password].map((field) => field.getAttribute('minlength')),
    ['6', '6'],
  );
  assert.equal(calls.some((call) => call.path === '/api/admins'), false);
  await view.tabs.administradores.dispatch('click');
  assert.equal(view.tabs.administradores.getAttribute('aria-selected'), 'true');
  assert.deepEqual(Object.keys(view.administratorFields).sort(), ['name', 'password', 'username']);
  assert.equal(view.administratorFields.email, undefined);
  assert.equal(view.administratorFields.phone, undefined);
  assert.deepEqual(
    view.administratorRows.children[0].children.map((cell) => cell.textContent),
    ['Bia Admin', 'bia.admin', 'Ativo', ''],
  );

  view.administratorFields.name.value = 'Caio Admin';
  view.administratorFields.username.value = 'caio.admin';
  view.administratorFields.password.value = 'senha-inicial-segura';
  await view.administratorForm.dispatch('submit');

  const createCall = calls.find((call) => call.path === '/api/admins' && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(createCall.options.body), {
    name: 'Caio Admin', username: 'caio.admin', password: 'senha-inicial-segura',
  });
  assert.equal(view.administratorFields.password.value, '');
  assert.equal(view.administratorSubmit.disabled, false);
  assert.equal(view.administratorFeedback.getAttribute('data-state'), 'success');
  assert.deepEqual(
    view.administratorRows.children[1].children.map((cell) => cell.textContent),
    ['Caio Admin', 'caio.admin', 'Ativo', ''],
  );
});

test('admin blocks administrator creation during a lazy list load so its stale response cannot discard a created account', async () => {
  let resolveAdministrators;
  const administrators = new Promise((resolve) => { resolveAdministrators = resolve; });
  const calls = [];
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/admins' && !options.method) return administrators;
      if (path === '/api/admins' && options.method === 'POST') {
        return { id: 'admin-3', name: 'Caio Admin', username: 'caio.admin', active: true };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;

  const loading = view.tabs.administradores.dispatch('click');
  await Promise.resolve();

  assert.equal(view.administratorSubmit.disabled, true);
  view.administratorFields.name.value = 'Caio Admin';
  view.administratorFields.username.value = 'caio.admin';
  view.administratorFields.password.value = 'senha-inicial-segura';
  await view.administratorForm.dispatch('submit');
  assert.equal(calls.filter((call) => call.path === '/api/admins' && call.options.method === 'POST').length, 0);

  resolveAdministrators([{ id: 'admin-2', name: 'Bia Admin', username: 'bia.admin', active: true }]);
  await loading;
  assert.equal(view.administratorSubmit.disabled, false);

  await view.administratorForm.dispatch('submit');
  assert.deepEqual(
    view.administratorRows.children.map((row) => row.children.map((cell) => cell.textContent)),
    [
      ['Bia Admin', 'bia.admin', 'Ativo', ''],
      ['Caio Admin', 'caio.admin', 'Ativo', ''],
    ],
  );
});

test('admin lazy-loads administrators after initial data resolves when the tab was selected early', async () => {
  let resolveSellers;
  let resolveCommissions;
  const sellers = new Promise((resolve) => { resolveSellers = resolve; });
  const commissions = new Promise((resolve) => { resolveCommissions = resolve; });
  const calls = [];
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      calls.push(path);
      if (path === '/api/users') return sellers;
      if (path === '/api/commissions') return commissions;
      if (path === '/api/admins') {
        return [{ id: 'admin-2', name: 'Bia Admin', username: 'bia.admin', active: true }];
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin', role: 'admin' },
    onSignOut: () => {},
  });

  await view.tabs.administradores.dispatch('click');
  assert.equal(calls.filter((path) => path === '/api/admins').length, 0);

  resolveSellers([]);
  resolveCommissions({ items: [] });
  await view.ready;

  assert.equal(calls.filter((path) => path === '/api/admins').length, 1);
  assert.deepEqual(
    view.administratorRows.children[0].children.map((cell) => cell.textContent),
    ['Bia Admin', 'bia.admin', 'Ativo', ''],
  );
});

test('admin requires the confirmation dialog before archiving another administrator', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/admins' && !options.method) return [
        { id: 'admin-1', name: 'Admin atual', username: 'admin.atual', active: true },
        { id: 'admin-2', name: 'Bia Admin', username: 'bia.admin', active: true },
      ];
      if (path === '/api/admins/admin-2' && options.method === 'DELETE') return undefined;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, {
    api,
    actor: { id: 'admin-1', name: 'Admin atual', role: 'admin' },
    onSignOut: () => {},
  });
  await view.ready;
  await view.tabs.administradores.dispatch('click');

  await view.administratorRows.children[1].children[3].children[0].children[0].dispatch('click');
  assert.equal(calls.some((call) => call.path === '/api/admins/admin-2' && call.options.method === 'DELETE'), false);

  view.confirmationPassword.value = 'senha-atual';
  await view.confirmationForm.dispatch('submit');

  const archiveCall = calls.find((call) => call.path === '/api/admins/admin-2' && call.options.method === 'DELETE');
  assert.deepEqual(JSON.parse(archiveCall.options.body), { password: 'senha-atual' });
  assert.equal(view.administratorRows.children.length, 1);
  assert.equal(view.administratorFeedback.textContent, 'Administrador arquivado.');
});

test('admin carrega a regra padrão em Produtos e usa a regra do produto selecionado no lançamento', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const products = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Plano fixo', commissionType: 'fixed', commissionInput: '25.00', active: true },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Plano percentual', commissionType: 'percentage', commissionInput: '12.50', active: true },
  ];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [] };
      if (path === '/api/products?includeInactive=true') return products;
      if (path === '/api/commission-default-rule' && !options.method) return null;
      if (path === '/api/commissions' && options.method === 'POST') {
        return { id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano percentual', commissionValue: '25.00', paymentStatus: 'pending', saleDate: '2026-09-07' };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.tabs.comissoes.dispatch('keydown', { key: 'ArrowRight' });

  assert.equal(view.tabs.produtos.getAttribute('aria-selected'), 'true');
  assert.match(renderedText(root), /Comissão padrão para itens sem regra individual/);
  assert.deepEqual(Object.keys(view.defaultRuleFields).sort(), ['commissionInput', 'commissionType']);
  assert.equal(view.defaultRuleFields.commissionType.value, 'percentage');
  assert.equal(view.defaultRuleFields.commissionInput.value, '');
  assert.equal(view.commissionSubmit.disabled, true);
  assert.equal(view.productRows.children.length, 2);
  assert.deepEqual(view.commissionFields.productId.children.map((option) => option.textContent), [
    'Lançamento manual ou legado', 'Plano fixo', 'Plano percentual',
  ]);

  view.commissionFields.sellerId.value = 'seller-1';
  view.commissionFields.productId.value = products[1].id;
  view.commissionFields.saleValue.value = '200';
  await view.commissionFields.productId.dispatch('change');
  assert.equal(view.commissionFields.product.value, 'Plano percentual');
  assert.equal(view.commissionFields.product.disabled, true);
  assert.equal(view.commissionSubmit.disabled, false);
  assert.equal(view.commissionPreview.textContent, 'Prévia do produto selecionado: R$ 25,00');
  view.commissionFields.saleDate.value = '2026-09-07';
  await view.commissionForm.dispatch('submit');

  const createCall = calls.find((call) => call.path === '/api/commissions' && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(createCall.options.body), {
    sellerId: 'seller-1',
    productId: products[1].id,
    saleValue: '200',
    saleDate: '2026-09-07',
    note: '',
  });
});

test('admin salva a regra padrão após confirmação sem senha e atualiza o filtro ativo', async () => {
  let resolveSave;
  let signalSaveStarted;
  const save = new Promise((resolve) => { resolveSave = resolve; });
  const saveStarted = new Promise((resolve) => { signalSaveStarted = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [] };
      if (path === '/api/commissions?sellerId=seller-1') return { items: [] };
      if (path === '/api/products?includeInactive=true') return [];
      if (path === '/api/commission-default-rule' && !options.method) return { commissionType: 'fixed', commissionInput: '20.00' };
      if (path === '/api/commission-default-rule' && options.method === 'PUT') {
        signalSaveStarted();
        return save;
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.produtos.dispatch('click');
  assert.equal(view.defaultRuleFields.commissionType.value, 'fixed');
  assert.equal(view.defaultRuleFields.commissionInput.value, '20.00');
  view.commissionFilters.sellerId.value = 'seller-1';
  await view.commissionFilterForm.dispatch('submit');
  view.defaultRuleFields.commissionType.value = 'percentage';
  view.defaultRuleFields.commissionInput.value = '7.50';

  await view.defaultRuleForm.dispatch('submit');

  assert.equal(view.confirmationDescription.textContent, 'As comissões pendentes sem produto cadastrado serão recalculadas. Pagas, anuladas e produtos com regra própria não serão alterados.');
  assert.equal(view.confirmationPassword.parentNode.hidden, true);
  assert.equal(calls.some((call) => call.path === '/api/commission-default-rule' && call.options.method === 'PUT'), false);

  const saving = view.confirmationForm.dispatch('submit');
  await saveStarted;
  assert.equal(view.defaultRuleFields.commissionType.disabled, true);
  assert.equal(view.defaultRuleFields.commissionInput.disabled, true);
  assert.equal(view.productFields.name.disabled, false);

  resolveSave({ commissionType: 'percentage', commissionInput: '7.50', recalculatedPendingCount: 3 });
  await saving;

  const saveCall = calls.find((call) => call.path === '/api/commission-default-rule' && call.options.method === 'PUT');
  assert.deepEqual(JSON.parse(saveCall.options.body), { commissionType: 'percentage', commissionInput: '7.50' });
  assert.equal(view.defaultRuleFields.commissionType.disabled, false);
  assert.equal(view.defaultRuleFields.commissionInput.disabled, false);
  assert.equal(view.defaultRuleFeedback.textContent, '3 comissão(ões) pendente(s) recalculada(s).');
  assert.equal(calls.filter((call) => call.path === '/api/commissions?sellerId=seller-1').length, 2);
});

test('admin mantém o sucesso da regra padrão quando a atualização de comissões falha', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const retainedCommission = {
    id: 'pending-1',
    sellerId: 'seller-1',
    sellerName: 'Ana',
    commissionValue: '25.00',
    paymentStatus: 'pending',
    saleDate: '2026-09-07',
  };
  let commissionReads = 0;
  const api = {
    request: async (path, options = {}) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) {
        commissionReads += 1;
        if (commissionReads === 1) return { items: [retainedCommission] };
        throw new Error('Falha ao atualizar a lista de comissões.');
      }
      if (path === '/api/products?includeInactive=true') return [];
      if (path === '/api/commission-default-rule' && !options.method) return null;
      if (path === '/api/commission-default-rule' && options.method === 'PUT') {
        return { commissionType: 'percentage', commissionInput: '7.50', recalculatedPendingCount: 3 };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.produtos.dispatch('click');
  assert.equal(view.commissionSubmit.disabled, true);
  assert.equal(view.commissionRows.children.length, 1);

  view.defaultRuleFields.commissionType.value = 'percentage';
  view.defaultRuleFields.commissionInput.value = '7.50';
  await view.defaultRuleForm.dispatch('submit');
  await view.confirmationForm.dispatch('submit');

  assert.equal(view.defaultRuleFields.commissionType.value, 'percentage');
  assert.equal(view.defaultRuleFields.commissionInput.value, '7.50');
  assert.equal(view.defaultRuleFeedback.textContent, '3 comissão(ões) pendente(s) recalculada(s). Regra salva; não foi possível atualizar a lista de comissões.');
  assert.equal(view.commissionSubmit.disabled, false);
  assert.equal(view.commissionRows.children.length, 1);
  assert.match(renderedText(view.commissionRows), /Ana/);
  assert.equal(commissionReads, 2);
});

test('admin preserva a regra padrão mais nova quando uma leitura anterior chega atrasada', async () => {
  let resolveFirstRule;
  let signalFirstRuleStarted;
  const firstRule = new Promise((resolve) => { resolveFirstRule = resolve; });
  const firstRuleStarted = new Promise((resolve) => { signalFirstRuleStarted = resolve; });
  let ruleReads = 0;
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/products?includeInactive=true') return [];
      if (path === '/api/commission-default-rule') {
        ruleReads += 1;
        if (ruleReads === 1) {
          signalFirstRuleStarted();
          return firstRule;
        }
        return { commissionType: 'fixed', commissionInput: '30.00' };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  const firstLoad = view.tabs.produtos.dispatch('click');
  await firstRuleStarted;
  await view.reloadDefaultRule();
  resolveFirstRule({ commissionType: 'percentage', commissionInput: '10.00' });
  await firstLoad;

  assert.equal(view.defaultRuleFields.commissionType.value, 'fixed');
  assert.equal(view.defaultRuleFields.commissionInput.value, '30.00');
});

test('admin carrega a regra padrão depois da carga inicial quando Produtos foi selecionado cedo', async () => {
  let resolveSellers;
  let resolveCommissions;
  const sellers = new Promise((resolve) => { resolveSellers = resolve; });
  const commissions = new Promise((resolve) => { resolveCommissions = resolve; });
  const calls = [];
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      calls.push(path);
      if (path === '/api/users') return sellers;
      if (path === '/api/commissions') return commissions;
      if (path === '/api/products?includeInactive=true') return [];
      if (path === '/api/commission-default-rule') return { commissionType: 'fixed', commissionInput: '15.00' };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });

  await view.tabs.produtos.dispatch('click');
  assert.equal(calls.includes('/api/commission-default-rule'), false);

  resolveSellers([]);
  resolveCommissions({ items: [] });
  await view.ready;
  await Promise.resolve();

  assert.equal(calls.filter((path) => path === '/api/commission-default-rule').length, 1);
  assert.equal(view.defaultRuleFields.commissionInput.value, '15.00');
});

test('admin cria, confirma edição de regra sem senha e alterna a situação do produto', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  let products = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Plano', commissionType: 'fixed', commissionInput: '20.00', active: true }];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [];
      if (path === '/api/commissions' && !options.method) return { items: [] };
      if (path === '/api/products?includeInactive=true' && !options.method) return products;
      if (path === '/api/products' && options.method === 'POST') {
        const created = { id: '33333333-3333-4333-8333-333333333333', ...JSON.parse(options.body), active: true };
        products = [...products, created];
        return created;
      }
      if (path === '/api/products/11111111-1111-4111-8111-111111111111' && options.method === 'PATCH') {
        products = [{ ...products[0], ...JSON.parse(options.body) }];
        return { ...products[0], recalculatedPendingCount: 3 };
      }
      if (path.endsWith('/deactivate') && options.method === 'POST') {
        products = [{ ...products[0], active: false }];
        return products[0];
      }
      if (path.endsWith('/activate') && options.method === 'POST') {
        products = [{ ...products[0], active: true }];
        return products[0];
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.produtos.dispatch('click');

  view.productFields.name.value = 'Novo plano';
  view.productFields.commissionType.value = 'percentage';
  view.productFields.commissionInput.value = '10';
  await view.productForm.dispatch('submit');
  assert.equal(calls.some((call) => call.path === '/api/products' && call.options.method === 'POST'), true);

  await view.productRows.children[0].children[4].children[0].children[0].dispatch('click');
  view.productFields.commissionInput.value = '25.00';
  await view.productForm.dispatch('submit');
  assert.equal(view.confirmationDescription.textContent, 'As comissões pendentes deste produto serão recalculadas. Pagas e anuladas não serão alteradas.');
  assert.equal(view.confirmationPassword.parentNode.hidden, true);
  assert.equal(calls.some((call) => call.options.method === 'PATCH'), false);

  await view.confirmationForm.dispatch('submit');
  const updateCall = calls.find((call) => call.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(updateCall.options.body), { name: 'Plano', commissionType: 'fixed', commissionInput: '25.00' });
  assert.equal(view.productFeedback.textContent, '3 comissão(ões) pendente(s) recalculada(s).');
  assert.equal(calls.filter((call) => call.path === '/api/commissions' && !call.options.method).length >= 2, true);

  await view.productRows.children[0].children[4].children[0].children[1].dispatch('click');
  assert.equal(view.productRows.children[0].children[2].textContent, 'Inativo');
  await view.productRows.children[0].children[4].children[0].children[0].dispatch('click');
  assert.equal(view.productRows.children[0].children[2].textContent, 'Ativo');
});

test('admin requires the confirmation dialog before deleting a product', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  let products = [{
    id: '11111111-1111-4111-8111-111111111111', name: 'Plano',
    commissionType: 'fixed', commissionInput: '20.00', active: true,
  }];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/products?includeInactive=true') return products;
      if (path === '/api/products/11111111-1111-4111-8111-111111111111' && options.method === 'DELETE') {
        products = [];
        return undefined;
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.produtos.dispatch('click');

  await view.productRows.children[0].children[4].children[0].children[2].dispatch('click');
  assert.equal(view.confirmationDialog.hidden, false);
  assert.equal(calls.some((call) => call.options.method === 'DELETE'), false);

  view.confirmationPassword.value = 'senha-atual';
  await view.confirmationForm.dispatch('submit');

  const deleteCall = calls.find((call) => call.options.method === 'DELETE');
  assert.deepEqual(JSON.parse(deleteCall.options.body), { password: 'senha-atual' });
  assert.equal(view.productFeedback.textContent, 'Produto excluído.');
});

test('admin requires the confirmation dialog before deleting a paid commission', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const commission = {
    id: 'commission-paid', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano pago',
    commissionValue: '10.00', paymentStatus: 'paid', saleDate: '2026-09-07',
  };
  const calls = [];
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions' && !options.method) return { items: [commission] };
      if (path === '/api/commissions/commission-paid' && options.method === 'DELETE') return undefined;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  await view.commissionRows.children[0].children[6].children[0].children[1].dispatch('click');
  assert.equal(view.confirmationDialog.hidden, false);
  assert.equal(calls.some((call) => call.path === '/api/commissions/commission-paid' && call.options.method === 'DELETE'), false);

  view.confirmationPassword.value = 'senha-atual';
  await view.confirmationForm.dispatch('submit');

  const deleteCall = calls.find((call) => call.path === '/api/commissions/commission-paid' && call.options.method === 'DELETE');
  assert.deepEqual(JSON.parse(deleteCall.options.body), { password: 'senha-atual' });
  assert.equal(view.commissionRows.children[0].children[0].textContent, 'Nenhuma comissão encontrada.');
});

test('admin preserva a resposta mais nova do catálogo quando uma leitura anterior chega atrasada', async () => {
  let resolveFirstProducts;
  let signalFirstProducts;
  const firstProducts = new Promise((resolve) => { resolveFirstProducts = resolve; });
  const firstProductsStarted = new Promise((resolve) => { signalFirstProducts = resolve; });
  let productReads = 0;
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/products?includeInactive=true') {
        productReads += 1;
        if (productReads === 1) {
          signalFirstProducts();
          return firstProducts;
        }
        return [{ id: '22222222-2222-4222-8222-222222222222', name: 'Catálogo novo', commissionType: 'fixed', commissionInput: '30.00', active: true }];
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  const firstLoad = view.tabs.produtos.dispatch('click');
  await firstProductsStarted;
  await view.reloadProducts();
  resolveFirstProducts([{ id: '11111111-1111-4111-8111-111111111111', name: 'Catálogo antigo', commissionType: 'fixed', commissionInput: '20.00', active: true }]);
  await firstLoad;

  assert.equal(view.productRows.children[0].children[0].textContent, 'Catálogo novo');
});

test('admin desabilita todas as ações dos produtos enquanto uma alteração está pendente', async () => {
  let resolveMutation;
  let signalMutationStarted;
  let resolveFailedMutation;
  let signalFailedMutationStarted;
  const mutation = new Promise((resolve) => { resolveMutation = resolve; });
  const mutationStarted = new Promise((resolve) => { signalMutationStarted = resolve; });
  const failedMutation = new Promise((resolve) => { resolveFailedMutation = resolve; });
  const failedMutationStarted = new Promise((resolve) => { signalFailedMutationStarted = resolve; });
  let products = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Plano ativo', commissionType: 'fixed', commissionInput: '20.00', active: true },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Plano inativo', commissionType: 'percentage', commissionInput: '10.00', active: false },
  ];
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path, options = {}) => {
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/products?includeInactive=true') return products;
      if (path.endsWith('/deactivate') && options.method === 'POST') {
        signalMutationStarted();
        await mutation;
        products = [{ ...products[0], active: false }, products[1]];
        return products[0];
      }
      if (path.endsWith('/activate') && options.method === 'POST') {
        signalFailedMutationStarted();
        await failedMutation;
        throw new Error('Não foi possível reativar o produto.');
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await view.tabs.produtos.dispatch('click');

  const activeActions = view.productRows.children[0].children[4].children[0].children;
  const reactivate = view.productRows.children[1].children[4].children[0].children[0];
  const deactivate = activeActions[1];
  for (const action of [...activeActions, reactivate]) assert.equal(action.disabled, false);

  const pendingDeactivate = deactivate.dispatch('click');
  await mutationStarted;
  assert.equal(activeActions[0].disabled, true);
  assert.equal(deactivate.disabled, true);
  assert.equal(reactivate.disabled, true);

  resolveMutation();
  await pendingDeactivate;
  for (const row of view.productRows.children) {
    for (const action of row.children[4].children[0].children) assert.equal(action.disabled, false);
  }

  const pendingReactivate = view.productRows.children[0].children[4].children[0].children[0].dispatch('click');
  await failedMutationStarted;
  for (const row of view.productRows.children) {
    for (const action of row.children[4].children[0].children) assert.equal(action.disabled, true);
  }

  resolveFailedMutation();
  await pendingReactivate;
  for (const row of view.productRows.children) {
    for (const action of row.children[4].children[0].children) assert.equal(action.disabled, false);
  }
});

test('admin foca Produtos sem aguardar o catálogo e não recupera foco após sair da aba', async () => {
  let resolveProducts;
  let signalProductsStarted;
  const products = new Promise((resolve) => { resolveProducts = resolve; });
  const productsStarted = new Promise((resolve) => { signalProductsStarted = resolve; });
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/products?includeInactive=true') {
        signalProductsStarted();
        return products;
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  const enteringProducts = view.tabs.comissoes.dispatch('keydown', { key: 'ArrowRight' });
  await productsStarted;
  assert.equal(document.activeElement?.textContent, 'Produtos');

  await view.tabs.produtos.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(document.activeElement?.textContent, 'Comissões');

  resolveProducts([]);
  await enteringProducts;
  assert.equal(document.activeElement?.textContent, 'Comissões');
});

test('admin preserva filtros digitados quando outra parte da tela é renderizada', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') return { items: [] };
      if (path.startsWith('/api/products')) return [];
      if (path === '/api/commission-default-rule') return null;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  view.commissionFilters.startDate.value = '2026-09-01';
  view.commissionFilters.paymentStatus.value = 'paid';

  await view.tabs.produtos.dispatch('click');

  assert.equal(view.commissionFilters.startDate.value, '2026-09-01');
  assert.equal(view.commissionFilters.paymentStatus.value, 'paid');
});

test('admin preserva a seleção de comissões ao renderizar de novo', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const pending = {
    id: 'commission-1', sellerId: 'seller-1', sellerName: 'Ana', product: 'Plano',
    commissionValue: '10.00', paymentStatus: 'pending', saleDate: '2026-09-07',
  };
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [{ id: 'seller-1', name: 'Ana', active: true }];
      if (path === '/api/commissions') return { items: [pending] };
      if (path.startsWith('/api/products')) return [];
      if (path === '/api/commission-default-rule') return null;
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  view.commissionRows.children[0].children[0].children[0].checked = true;
  await view.tabs.produtos.dispatch('click');

  assert.equal(view.commissionRows.children[0].children[0].children[0].checked, true);
});

test('admin carrega o histórico aberto durante a carga inicial', async () => {
  let resolveSellers;
  const sellers = new Promise((resolve) => { resolveSellers = resolve; });
  const auditRequests = [];
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return sellers;
      if (path === '/api/commissions') return { items: [] };
      if (path.startsWith('/api/audit-events')) {
        auditRequests.push(path);
        return { items: [] };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });

  await view.tabs.historico.dispatch('click');
  assert.equal(auditRequests.length, 0);

  resolveSellers([]);
  await view.ready;
  await Promise.resolve();

  assert.equal(auditRequests.length, 1);
});

test('admin liga o modo dicas e explica uma aba', async (t) => {
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
  const api = { request: async (path) => (path === '/api/users' ? [] : { items: [] }) };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.helpMode.isEnabled(), false);
  assert.equal(view.tabs.vendedores.getAttribute('data-help'), 'Cadastre, edite, desative, reative ou exclua vendedores.');

  await view.helpMode.button.dispatch('click');
  assert.equal(view.helpMode.isEnabled(), true);

  view.helpMode.handlePointerOver({ target: { closest: () => view.tabs.vendedores } });
  assert.equal(view.helpMode.tooltip.hidden, false);
  assert.equal(view.helpMode.tooltip.textContent, 'Cadastre, edite, desative, reative ou exclua vendedores.');

  view.helpMode.handlePointerOut({ target: { closest: () => view.tabs.vendedores } });
  assert.equal(view.helpMode.tooltip.hidden, true);
});

test('admin marca o checklist de primeiros passos ao cadastrar um vendedor', async (t) => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });

  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path, options = {}) => {
      if (path === '/api/users' && !options.method) return [];
      if (path === '/api/users' && options.method === 'POST') {
        return { id: 'seller-2', name: 'Beatriz', username: 'bia', phone: '', active: true };
      }
      if (path === '/api/commissions') return { items: [] };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.checklist.itemCount, 3);
  assert.equal(view.checklist.isComplete('seller'), false);

  view.sellerFields.name.value = 'Beatriz';
  view.sellerFields.username.value = 'bia';
  view.sellerFields.password.value = 'senha-segura-123';
  await view.sellerForm.dispatch('submit');

  assert.equal(view.checklist.isComplete('seller'), true);
  assert.equal(view.checklist.progress.textContent, '1 de 3 concluído(s)');
  assert.equal(store.get('galaxy-smart-checklist:admin'), JSON.stringify(['seller']));
});

test('admin reativa um vendedor desativado pelo botão Ativar', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const calls = [];
  const inactive = { id: 'seller-1', name: 'Ana', username: 'ana', phone: '', active: false };
  const api = {
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/users' && !options.method) return [inactive];
      if (path === '/api/commissions') return { items: [] };
      if (path === '/api/users/seller-1/enable' && options.method === 'POST') {
        return { ...inactive, active: true };
      }
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.sellerRows.children[0].children[3].textContent, 'Desativado');

  await view.sellerRows.children[0].children[4].children[0].children[1].dispatch('click');

  assert.equal(view.sellerRows.children[0].children[3].textContent, 'Ativo');
  assert.equal(view.sellerFeedback.textContent, 'Vendedor reativado.');
  assert.equal(
    calls.some((call) => call.path === '/api/users/seller-1/enable' && call.options.method === 'POST'),
    true,
  );
});

test('admin abre o tour de ajuda pelo botão Ajuda e destaca cada aba', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;

  assert.equal(view.tour.element.hidden, true);
  assert.equal(view.tour.isActive(), false);

  await view.tourButton.dispatch('click');
  assert.equal(view.tour.isActive(), true);
  assert.equal(view.tour.title.textContent, 'Bem-vindo à Administração de comissões');
  assert.equal(view.tour.progress.textContent, `Passo 1 de ${view.tour.stepCount}`);

  view.tour.next();
  assert.equal(view.tour.title.textContent, 'Resumo');
  assert.match(view.tabs.resumo.className, /tour-highlight/);

  view.tour.next();
  assert.equal(view.tour.title.textContent, 'Vendedores');
  assert.doesNotMatch(view.tabs.resumo.className, /tour-highlight/);
  assert.match(view.tabs.vendedores.className, /tour-highlight/);

  view.tour.skipButton.click();
  assert.equal(view.tour.isActive(), false);
  assert.equal(view.tour.element.hidden, true);
});

test('admin inicia o tour automaticamente no primeiro acesso', async (t) => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map();
  const document = createDocument();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  });
  t.after(() => {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else delete globalThis.document;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });

  const root = document.createElement('div');
  const api = {
    request: async (path) => {
      if (path === '/api/users') return [];
      if (path === '/api/commissions') return { items: [] };
      throw new Error(`Rota inesperada: ${path}`);
    },
  };
  const view = renderAdmin(root, { api, actor: { id: 'admin-1', name: 'Admin', role: 'admin' }, onSignOut: () => {} });
  await view.ready;
  await Promise.resolve();

  assert.equal(view.tour.isActive(), true);
  assert.equal(view.tour.title.textContent, 'Bem-vindo à Administração de comissões');
  assert.equal(store.has('galaxy-smart-tour-seen:admin'), false);
});
