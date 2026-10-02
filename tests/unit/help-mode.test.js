import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelpMode, helpStorageKey } from '../../src/client/views/help-mode.js';

function createDocument() {
  const document = {
    createElement(tagName) {
      const listeners = new Map();
      const attributes = new Map();
      return {
        tagName: tagName.toUpperCase(),
        ownerDocument: document,
        children: [],
        hidden: false,
        disabled: false,
        textContent: '',
        className: '',
        style: {
          values: {},
          setProperty(name, value) {
            this.values[name] = value;
          },
        },
        append(...children) {
          this.children.push(...children);
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
        click() {
          listeners.get('click')?.({ preventDefault() {} });
        },
        focus() {
          this.focused = true;
        },
      };
    },
  };
  return document;
}

function withStorage(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return store;
}

test('help mode registers tips on controls and starts disabled', () => {
  const document = createDocument();
  const container = document.createElement('main');
  const control = document.createElement('button');
  const help = createHelpMode(document, { storageKey: helpStorageKey('admin'), container });

  help.register(control, 'Cria o vendedor.');

  assert.equal(control.getAttribute('data-help'), 'Cria o vendedor.');
  assert.equal(help.isEnabled(), false);
  assert.equal(help.button.getAttribute('aria-pressed'), 'false');
  assert.equal(help.tooltip.hidden, true);
});

test('help mode shows and hides the tooltip for a registered control', () => {
  const document = createDocument();
  const container = document.createElement('main');
  const control = document.createElement('button');
  const help = createHelpMode(document, { storageKey: helpStorageKey('admin'), container });
  help.register(control, 'Baixa a planilha.');

  help.show(control);
  assert.equal(help.tooltip.hidden, false);
  assert.equal(help.tooltip.textContent, 'Baixa a planilha.');
  assert.match(help.tooltip.className, /help-tooltip--visible/);
  assert.equal(control.getAttribute('aria-describedby'), 'help-tooltip');

  help.hide();
  assert.equal(help.tooltip.hidden, true);
  assert.doesNotMatch(help.tooltip.className, /help-tooltip--visible/);
  assert.equal(control.getAttribute('aria-describedby'), null);
});

test('help mode only reacts to pointer events while it is enabled', (t) => {
  const store = withStorage(t);
  const document = createDocument();
  const container = document.createElement('main');
  const control = document.createElement('button');
  const help = createHelpMode(document, { storageKey: helpStorageKey('admin'), container });
  help.register(control, 'Aplica os filtros.');
  const event = { target: { closest: () => control } };

  help.handlePointerOver(event);
  assert.equal(help.tooltip.hidden, true);

  help.setEnabled(true);
  assert.equal(help.isEnabled(), true);
  assert.equal(help.button.getAttribute('aria-pressed'), 'true');
  assert.equal(store.get('galaxy-smart-help-mode:admin'), 'true');

  help.handlePointerOver(event);
  assert.equal(help.tooltip.hidden, false);
  assert.equal(help.tooltip.textContent, 'Aplica os filtros.');

  help.handlePointerOut(event);
  assert.equal(help.tooltip.hidden, true);
});

test('help mode toggles from its button and clears the tooltip when turned off', (t) => {
  withStorage(t);
  const document = createDocument();
  const container = document.createElement('main');
  const control = document.createElement('button');
  const help = createHelpMode(document, { storageKey: helpStorageKey('seller'), container });
  help.register(control, 'Altera a senha.');

  help.button.click();
  assert.equal(help.isEnabled(), true);

  help.show(control);
  assert.equal(help.tooltip.hidden, false);

  help.button.click();
  assert.equal(help.isEnabled(), false);
  assert.equal(help.tooltip.hidden, true);
});