import test from 'node:test';
import assert from 'node:assert/strict';
import { checklistStorageKey, createChecklist } from '../../src/client/views/checklist.js';

function createDocument() {
  const document = {
    createElement(tagName) {
      const attributes = new Map();
      return {
        tagName: tagName.toUpperCase(),
        ownerDocument: document,
        children: [],
        hidden: false,
        textContent: '',
        className: '',
        append(...children) {
          this.children.push(...children);
        },
        replaceChildren(...children) {
          this.children = [];
          this.append(...children);
        },
        setAttribute(name, value) {
          attributes.set(name, String(value));
        },
        removeAttribute(name) {
          attributes.delete(name);
        },
        getAttribute(name) {
          return attributes.get(name) ?? null;
        },
      };
    },
  };
  return document;
}

function withStorage(t, entries = []) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map(entries);
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

const items = [
  { id: 'seller', label: 'Cadastre um vendedor', hint: 'Aba Vendedores' },
  { id: 'product', label: 'Defina um produto', hint: 'Aba Produtos' },
];

test('checklist lists the first steps and starts empty', (t) => {
  withStorage(t);
  const document = createDocument();
  const checklist = createChecklist(document, { storageKey: checklistStorageKey('admin'), items });

  assert.equal(checklist.itemCount, 2);
  assert.equal(checklist.completedCount(), 0);
  assert.equal(checklist.list.children.length, 2);
  assert.equal(checklist.list.children[0].className, 'checklist-item');
  assert.equal(checklist.progress.textContent, '0 de 2 concluído(s)');
});

test('checklist marks a step as done and persists the progress', (t) => {
  const store = withStorage(t);
  const document = createDocument();
  const checklist = createChecklist(document, { storageKey: checklistStorageKey('admin'), items });

  checklist.complete('seller');

  assert.equal(checklist.isComplete('seller'), true);
  assert.equal(checklist.completedCount(), 1);
  assert.equal(checklist.progress.textContent, '1 de 2 concluído(s)');
  assert.equal(checklist.list.children[0].className, 'checklist-item checklist-item--done');
  assert.equal(store.get('galaxy-smart-checklist:admin'), JSON.stringify(['seller']));
});

test('checklist restores progress from storage and celebrates completion', (t) => {
  withStorage(t, [['galaxy-smart-checklist:admin', JSON.stringify(['seller', 'product'])]]);
  const document = createDocument();
  const checklist = createChecklist(document, { storageKey: checklistStorageKey('admin'), items });

  assert.equal(checklist.completedCount(), 2);
  assert.equal(checklist.progress.textContent, 'Tudo pronto! Você já conhece o essencial.');
  assert.equal(checklist.element.className, 'checklist checklist--complete');
});

test('checklist ignores unknown steps and can reset', (t) => {
  withStorage(t);
  const document = createDocument();
  const checklist = createChecklist(document, { storageKey: checklistStorageKey('admin'), items });

  checklist.complete('nao-existe');
  assert.equal(checklist.completedCount(), 0);

  checklist.complete('seller');
  checklist.reset();
  assert.equal(checklist.completedCount(), 0);
  assert.equal(checklist.progress.textContent, '0 de 2 concluído(s)');
});