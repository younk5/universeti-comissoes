import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLogin } from '../../src/client/views/login-view.js';

function createDocument() {
  const document = {
    createElement(tagName) {
      const listeners = new Map();
      const attributes = new Map();
      return {
        tagName: tagName.toUpperCase(),
        ownerDocument: document,
        children: [],
        value: '',
        disabled: false,
        textContent: '',
        append(...children) {
          this.children.push(...children);
        },
        replaceChildren(...children) {
          this.children = children;
        },
        setAttribute(name, value) {
          attributes.set(name, String(value));
        },
        getAttribute(name) {
          return attributes.get(name) ?? null;
        },
        addEventListener(type, listener) {
          listeners.set(type, listener);
        },
        async dispatch(type) {
          await listeners.get(type)({ preventDefault() {} });
        },
        focus() {},
      };
    },
  };
  return document;
}

function sessionClient(login = async () => {}) {
  return { login };
}

test('login renders credential fields with accessible semantics', () => {
  const document = createDocument();
  const root = document.createElement('div');

  const view = renderLogin(root, { sessionClient: sessionClient() });

  assert.equal(root.children[0].tagName, 'MAIN');
  assert.equal(root.children[0].children[0].getAttribute('data-login-layout'), 'modern');
  assert.equal(root.children[0].children[0].children[0].children[0].getAttribute('src'), '/assets/universe-ti.svg');
  assert.equal(root.children[0].children[0].children[0].children[0].getAttribute('alt'), 'Universe TI');
  assert.equal(view.form.tagName, 'FORM');
  assert.equal(view.identifier.name, 'identifier');
  assert.equal(view.identifier.getAttribute('autocomplete'), 'username');
  assert.equal(view.identifier.getAttribute('required'), '');
  assert.equal(view.password.type, 'password');
  assert.equal(view.password.getAttribute('autocomplete'), 'current-password');
  assert.equal(view.password.getAttribute('minlength'), '6');
  assert.equal(view.password.getAttribute('required'), '');
  assert.equal(view.submitButton.textContent, 'Entrar');
  assert.equal(view.feedback.getAttribute('aria-live'), 'polite');
});

test('login announces a received session message through aria-live', () => {
  const document = createDocument();
  const root = document.createElement('div');

  const view = renderLogin(root, {
    sessionClient: sessionClient(),
    message: 'Sua sessão expirou. Entre novamente.',
  });

  assert.equal(view.feedback.textContent, 'Sua sessão expirou. Entre novamente.');
});

test('login submits trimmed credentials through the session client before loading the actor', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const events = [];
  const view = renderLogin(root, {
    sessionClient: sessionClient(async (credentials) => {
      events.push(['session', credentials]);
      return { id: 'seller-1' };
    }),
    onAuthenticated: async () => events.push(['actor']),
  });
  view.identifier.value = '  vendas.sp  ';
  view.password.value = 'senha-correta';

  await view.form.dispatch('submit');

  assert.deepEqual(events, [
    ['session', { identifier: 'vendas.sp', password: 'senha-correta' }],
    ['actor'],
  ]);
  assert.equal(view.password.value, 'senha-correta');
  assert.equal(view.feedback.textContent, '');
  assert.equal(view.submitButton.disabled, false);
  assert.equal(view.submitButton.textContent, 'Entrar');
});

test('login clears only the password and announces an invalid credential error', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  let actorLoadCalls = 0;
  const view = renderLogin(root, {
    sessionClient: sessionClient(async () => {
      throw new Error('internal login failure');
    }),
    onAuthenticated: async () => { actorLoadCalls += 1; },
  });
  view.identifier.value = '  vendas.sp  ';
  view.password.value = 'senha-incorreta';

  await view.form.dispatch('submit');

  assert.equal(actorLoadCalls, 0);
  assert.equal(view.identifier.value, '  vendas.sp  ');
  assert.equal(view.password.value, '');
  assert.equal(view.feedback.textContent, 'Usuário ou senha inválidos.');
  assert.equal(view.feedback.getAttribute('data-state'), 'error');
  assert.equal(view.submitButton.disabled, false);
  assert.equal(view.submitButton.textContent, 'Entrar');
});

test('login anuncia falha de conexão em vez de credencial inválida', async () => {
  const document = createDocument();
  const root = document.createElement('div');
  const view = renderLogin(root, {
    sessionClient: sessionClient(async () => {
      throw new Error('Não foi possível conectar ao servidor. Tente novamente.');
    }),
  });
  view.identifier.value = 'vendas.sp';
  view.password.value = 'senha-correta';

  await view.form.dispatch('submit');

  assert.equal(view.feedback.textContent, 'Não foi possível conectar ao servidor. Tente novamente.');
  assert.equal(view.feedback.getAttribute('data-state'), 'error');
  assert.equal(view.password.value, '');
  assert.equal(view.submitButton.disabled, false);
});
