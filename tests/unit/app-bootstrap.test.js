import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from '../../src/client/app-bootstrap.js';

function createDocument() {
  const document = {
    createElement(tagName) {
      const attributes = new Map();
      return {
        tagName: tagName.toUpperCase(),
        ownerDocument: document,
        children: [],
        className: '',
        textContent: '',
        value: '',
        disabled: false,
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
        addEventListener() {},
        focus() {},
      };
    },
  };
  return document;
}

test('bootstrap exibe o login diretamente quando não há sessão restaurável', async (t) => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const document = createDocument();
  const root = document.createElement('div');
  const requests = [];
  globalThis.document = document;
  globalThis.fetch = async (path) => {
    requests.push(path);
    return { ok: false, status: 401, json: async () => ({}) };
  };
  t.after(() => {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  });

  await bootstrap(root);

  assert.deepEqual(requests, ['/api/auth/refresh']);
  assert.equal(root.children[0].className, 'app-shell login-shell');
  assert.equal(root.children[0].getAttribute('data-public-home'), null);
});
