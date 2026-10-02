import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutoStartTour, createTour, hasSeenTour, markTourSeen, tourStorageKey } from '../../src/client/views/tour.js';

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
        textContent: '',
        className: '',
        disabled: false,
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

test('tour renders the first step and highlights the current target', () => {
  const document = createDocument();
  const target = document.createElement('button');
  target.className = 'admin-tab';
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      { title: 'Primeiro', description: 'Descrição 1' },
      { target: () => target, title: 'Segundo', description: 'Descrição 2' },
    ],
  });

  assert.equal(tour.element.hidden, true);
  assert.equal(tour.isActive(), false);

  tour.start();

  assert.equal(tour.isActive(), true);
  assert.equal(tour.element.hidden, false);
  assert.equal(tour.title.textContent, 'Primeiro');
  assert.equal(tour.description.textContent, 'Descrição 1');
  assert.equal(tour.progress.textContent, 'Passo 1 de 2');
  assert.equal(tour.nextButton.textContent, 'Próximo');
  assert.equal(tour.previousButton.disabled, true);

  tour.next();

  assert.equal(tour.title.textContent, 'Segundo');
  assert.equal(tour.progress.textContent, 'Passo 2 de 2');
  assert.equal(tour.nextButton.textContent, 'Concluir');
  assert.equal(tour.previousButton.disabled, false);
  assert.equal(tour.currentIndex(), 1);
  assert.match(target.className, /tour-highlight/);
});

test('tour moves back and finishes on the last step, recording itself as seen', (t) => {
  const store = withStorage(t);
  const document = createDocument();
  const tour = createTour(document, {
    storageKey: 'galaxy-smart-tour-seen:admin',
    steps: [
      { title: 'Um', description: 'a' },
      { title: 'Dois', description: 'b' },
    ],
  });

  tour.start();
  tour.next();
  tour.previous();
  assert.equal(tour.currentIndex(), 0);

  tour.next();
  tour.next();

  assert.equal(tour.isActive(), false);
  assert.equal(tour.element.hidden, true);
  assert.equal(store.get('galaxy-smart-tour-seen:admin'), 'true');
});

test('tour removes the highlight from the previous target when the step changes', () => {
  const document = createDocument();
  const first = document.createElement('button');
  const second = document.createElement('button');
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      { target: () => first, title: 'Um', description: 'a' },
      { target: () => second, title: 'Dois', description: 'b' },
    ],
  });

  tour.start();
  assert.match(first.className, /tour-highlight/);

  tour.next();
  assert.doesNotMatch(first.className, /tour-highlight/);
  assert.match(second.className, /tour-highlight/);
});

test('tour skip hides the overlay and records itself as seen', (t) => {
  const store = withStorage(t);
  const document = createDocument();
  const tour = createTour(document, {
    storageKey: 'galaxy-smart-tour-seen:seller',
    steps: [{ title: 'Um', description: 'a' }],
  });

  tour.start();
  tour.skipButton.click();

  assert.equal(tour.isActive(), false);
  assert.equal(tour.element.hidden, true);
  assert.equal(store.get('galaxy-smart-tour-seen:seller'), 'true');
});

test('hasSeenTour and markTourSeen read and write the browser storage', (t) => {
  const store = withStorage(t);

  assert.equal(hasSeenTour('galaxy-smart-tour-seen:admin'), false);
  markTourSeen('galaxy-smart-tour-seen:admin');
  assert.equal(hasSeenTour('galaxy-smart-tour-seen:admin'), true);
  assert.equal(store.get('galaxy-smart-tour-seen:admin'), 'true');
});

test('hasSeenTour and canAutoStartTour degrade safely without storage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  try {
    assert.equal(hasSeenTour('galaxy-smart-tour-seen:admin'), true);
    assert.equal(canAutoStartTour(), false);
    assert.doesNotThrow(() => markTourSeen('galaxy-smart-tour-seen:admin'));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('tour move o foco para o elemento destacado em passos interativos', () => {
  const document = createDocument();
  const target = document.createElement('button');
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      { target: () => target, title: 'Primeiro', description: 'a' },
      { title: 'Segundo', description: 'b' },
    ],
  });

  tour.start();
  assert.equal(target.focused, true);

  tour.next();
  assert.equal(tour.nextButton.focused, true);
});

test('tour devolve o foco ao elemento anterior quando fecha', () => {
  const document = createDocument();
  const opener = document.createElement('button');
  const target = document.createElement('button');
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [{ target: () => target, title: 'Um', description: 'a' }],
  });

  opener.focus();
  tour.start();
  tour.skipButton.click();

  assert.equal(opener.focused, true);
});

test('tour avança quando o usuário clica no elemento destacado', () => {
  const document = createDocument();
  const target = document.createElement('button');
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      { target: () => target, title: 'Primeiro', description: 'a' },
      { title: 'Segundo', description: 'b' },
    ],
  });

  tour.start();
  assert.equal(tour.currentIndex(), 0);
  assert.match(target.className, /tour-highlight/);

  target.click();

  assert.equal(tour.currentIndex(), 1);
  assert.equal(tour.title.textContent, 'Segundo');
});

test('tour não avança pelo clique quando o passo pede o botão Próximo', () => {
  const document = createDocument();
  const target = document.createElement('button');
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      { target: () => target, interactive: false, title: 'Primeiro', description: 'a' },
      { title: 'Segundo', description: 'b' },
    ],
  });

  tour.start();
  target.click();

  assert.equal(tour.currentIndex(), 0);
});

test('tour posiciona o holofote com as medidas do elemento destacado', (t) => {
  const document = createDocument();
  const target = document.createElement('button');
  target.getBoundingClientRect = () => ({ top: 100, left: 40, width: 120, height: 30, right: 160, bottom: 130 });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');
  Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 900 });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'innerWidth', descriptor);
    else delete globalThis.innerWidth;
  });

  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [{ target: () => target, title: 'Um', description: 'a' }],
  });
  tour.start();

  assert.match(tour.element.className, /tour-overlay--positioned/);
  assert.equal(tour.element.style.values['--tour-left'], '32px');
  assert.equal(tour.element.style.values['--tour-top'], '92px');
  assert.equal(tour.element.style.values['--tour-width'], '136px');
  assert.equal(tour.element.style.values['--tour-height'], '46px');
});

test('tour mostra a miniatura da tela do passo', () => {
  const document = createDocument();
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [{ icon: 'resumo', mockup: 'chart', title: 'Um', description: 'a' }],
  });

  tour.start();

  assert.equal(tour.mockup.children.length, 1);
  assert.match(tour.mockup.children[0].className, /tour-mockup--chart/);
});

test('tour exige resposta do quiz antes de concluir', () => {
  const document = createDocument();
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      {
        icon: 'estrela',
        title: 'Revisão',
        description: 'Pergunta final',
        quiz: {
          question: 'Qual aba cadastra vendedores?',
          options: [
            { label: 'Produtos', correct: false },
            { label: 'Vendedores', correct: true },
          ],
        },
      },
    ],
  });

  tour.start();
  assert.equal(tour.quizOptions.hidden, false);
  assert.equal(tour.quizOptions.children.length, 3);

  tour.next();
  assert.equal(tour.isActive(), true);
  assert.equal(tour.isQuizAnswered(), false);
  assert.match(tour.quizFeedback.textContent, /Escolha uma resposta/);

  tour.answerQuiz(1);
  assert.equal(tour.isQuizAnswered(), true);
  assert.match(tour.quizFeedback.textContent, /Isso mesmo/);

  tour.next();
  assert.equal(tour.isActive(), false);
});

test('tour revela a resposta correta quando o quiz é respondido errado', () => {
  const document = createDocument();
  const tour = createTour(document, {
    storageKey: tourStorageKey('admin'),
    steps: [
      {
        title: 'Revisão',
        description: 'Pergunta final',
        quiz: {
          question: 'Qual aba?',
          options: [
            { label: 'Produtos', correct: false },
            { label: 'Vendedores', correct: true },
          ],
        },
      },
    ],
  });

  tour.start();
  tour.answerQuiz(0);

  assert.match(tour.quizFeedback.textContent, /Vendedores/);
  assert.match(tour.quizOptions.children[1].className, /tour-quiz-option--wrong/);
  assert.match(tour.quizOptions.children[2].className, /tour-quiz-option--correct/);
});