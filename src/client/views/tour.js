const storageKeyPrefix = 'galaxy-smart-tour-seen:';
const highlightClass = 'tour-highlight';
const svgNamespace = 'http://www.w3.org/2000/svg';

const iconPaths = {
  inicio: [
    { tag: 'circle', attributes: { cx: '12', cy: '12', r: '3.5' } },
    { tag: 'path', attributes: { d: 'M12 2.5v3.5M12 18v3.5M2.5 12h3.5M18 12h3.5M5.2 5.2l2.5 2.5M16.3 16.3l2.5 2.5M18.8 5.2l-2.5 2.5M7.7 16.3l-2.5 2.5' } },
  ],
  resumo: [
    { tag: 'path', attributes: { d: 'M4 20V11M10 20V4M16 20v-7M22 20H2' } },
  ],
  pessoa: [
    { tag: 'circle', attributes: { cx: '12', cy: '8', r: '3.5' } },
    { tag: 'path', attributes: { d: 'M4.5 20.5c0-3.6 3.4-5.5 7.5-5.5s7.5 1.9 7.5 5.5' } },
  ],
  dinheiro: [
    { tag: 'rect', attributes: { x: '2.5', y: '6.5', width: '19', height: '11', rx: '2.5' } },
    { tag: 'circle', attributes: { cx: '12', cy: '12', r: '2.5' } },
    { tag: 'path', attributes: { d: 'M6 12h.01M18 12h.01' } },
  ],
  caixa: [
    { tag: 'path', attributes: { d: 'M12 3 3.5 7.3v9.4L12 21l8.5-4.3V7.3L12 3Z' } },
    { tag: 'path', attributes: { d: 'M3.5 7.3 12 11.7l8.5-4.4M12 11.7V21' } },
  ],
  relogio: [
    { tag: 'circle', attributes: { cx: '12', cy: '12', r: '8.5' } },
    { tag: 'path', attributes: { d: 'M12 7.5V12l3 2' } },
  ],
  escudo: [
    { tag: 'path', attributes: { d: 'M12 3 5.5 5.8v5.6c0 4 2.8 7.2 6.5 9.1 3.7-1.9 6.5-5.1 6.5-9.1V5.8L12 3Z' } },
    { tag: 'path', attributes: { d: 'M9 12l2.2 2.2L15.5 10' } },
  ],
  ajuda: [
    { tag: 'circle', attributes: { cx: '12', cy: '12', r: '8.5' } },
    { tag: 'path', attributes: { d: 'M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.4 1-1.4 1.9v.4' } },
    { tag: 'path', attributes: { d: 'M12 17.3h.01' } },
  ],
  saida: [
    { tag: 'path', attributes: { d: 'M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5' } },
    { tag: 'path', attributes: { d: 'M10 8l-4 4 4 4M6 12h9' } },
  ],
  chave: [
    { tag: 'rect', attributes: { x: '5.5', y: '10.5', width: '13', height: '9.5', rx: '2.2' } },
    { tag: 'path', attributes: { d: 'M8.8 10.5V7.8a3.2 3.2 0 0 1 6.4 0v2.7' } },
    { tag: 'path', attributes: { d: 'M12 14.4v2' } },
  ],
  estrela: [
    { tag: 'path', attributes: { d: 'M12 3.6l2.6 5.2 5.7.8-4.1 4 1 5.7-5.2-2.7-5.2 2.7 1-5.7-4.1-4 5.7-.8L12 3.6Z' } },
  ],
  lista: [
    { tag: 'path', attributes: { d: 'M4 6.5l1.8 1.8L9 5' } },
    { tag: 'path', attributes: { d: 'M4 17.5l1.8 1.8L9 16' } },
    { tag: 'path', attributes: { d: 'M12 7.5h8M12 18h8' } },
  ],
};

function createElement(document, tagName, { className, text, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function addClassName(element, token) {
  if (!element) return;
  const tokens = String(element.className ?? '').split(/\s+/).filter(Boolean);
  if (!tokens.includes(token)) tokens.push(token);
  element.className = tokens.join(' ');
}

function removeClassName(element, token) {
  if (!element) return;
  element.className = String(element.className ?? '')
    .split(/\s+/)
    .filter((value) => value && value !== token)
    .join(' ');
}

function isFocusable(element) {
  if (!element || typeof element.focus !== 'function') return false;
  const tag = String(element.tagName ?? '').toUpperCase();
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return true;
  const tabindex = typeof element.getAttribute === 'function' ? element.getAttribute('tabindex') : null;
  return tabindex !== null && tabindex !== undefined;
}

function createIcon(document, name) {
  const paths = iconPaths[name] ?? iconPaths.inicio;
  if (typeof document.createElementNS !== 'function') {
    return createElement(document, 'span', { className: 'tour-icon' });
  }
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'tour-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const path of paths) {
    const node = document.createElementNS(svgNamespace, path.tag);
    for (const [attribute, value] of Object.entries(path.attributes)) {
      node.setAttribute(attribute, value);
    }
    svg.appendChild(node);
  }
  return svg;
}

function createMockup(document, kind) {
  const wrap = createElement(document, 'div', {
    className: `tour-mockup tour-mockup--${kind ?? 'card'}`,
    attributes: { 'aria-hidden': 'true' },
  });
  if (kind === 'tabs') {
    const bar = createElement(document, 'div', { className: 'tour-mockup__tabs' });
    for (let index = 0; index < 5; index += 1) {
      bar.append(createElement(document, 'span', { className: 'tour-mockup__tab' }));
    }
    wrap.append(bar, createElement(document, 'div', { className: 'tour-mockup__block' }));
    return wrap;
  }
  if (kind === 'form') {
    for (let index = 0; index < 3; index += 1) {
      wrap.append(createElement(document, 'span', { className: 'tour-mockup__field' }));
    }
    wrap.append(createElement(document, 'span', { className: 'tour-mockup__button' }));
    return wrap;
  }
  if (kind === 'table') {
    wrap.append(createElement(document, 'span', { className: 'tour-mockup__row tour-mockup__row--head' }));
    for (let index = 0; index < 3; index += 1) {
      wrap.append(createElement(document, 'span', { className: 'tour-mockup__row' }));
    }
    return wrap;
  }
  if (kind === 'chart') {
    const bars = createElement(document, 'div', { className: 'tour-mockup__bars' });
    for (const height of ['40%', '70%', '55%', '90%']) {
      const bar = createElement(document, 'span', { className: `tour-mockup__bar tour-mockup__bar--${height.replace('%', '')}` });
      bars.append(bar);
    }
    wrap.append(bars);
    return wrap;
  }
  wrap.append(
    createElement(document, 'span', { className: 'tour-mockup__row tour-mockup__row--head' }),
    createElement(document, 'span', { className: 'tour-mockup__row' }),
    createElement(document, 'span', { className: 'tour-mockup__row' }),
  );
  return wrap;
}

function readStorage(storageKey) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return undefined;
    return storage.getItem(storageKey);
  } catch {
    return undefined;
  }
}

export function tourStorageKey(scope) {
  return `${storageKeyPrefix}${scope}`;
}

export function hasSeenTour(storageKey) {
  const value = readStorage(storageKey);
  if (value === undefined) return true;
  return value === 'true';
}

export function markTourSeen(storageKey) {
  try {
    globalThis.localStorage?.setItem(storageKey, 'true');
  } catch {
    // Storage can be unavailable (private mode); the tour simply reappears.
  }
}

export function canAutoStartTour() {
  try {
    return typeof globalThis.document !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function createTour(document, { steps = [], storageKey, onFinish } = {}) {
  const icon = createIcon(document, steps[0]?.icon);
  const progress = createElement(document, 'p', {
    className: 'tour-progress',
    attributes: { 'aria-live': 'polite' },
  });
  const heading = createElement(document, 'div', { className: 'tour-heading' });
  heading.append(icon, progress);

  const title = createElement(document, 'h2', { className: 'tour-title', attributes: { id: 'tour-title' } });
  const description = createElement(document, 'p', {
    className: 'tour-description',
    attributes: { id: 'tour-description' },
  });
  const mockupHolder = createElement(document, 'div', { className: 'tour-mockup-holder' });
  const body = createElement(document, 'div', { className: 'tour-body' });
  body.append(mockupHolder, description);

  const progressTrack = createElement(document, 'div', { className: 'tour-progress-track' });
  const progressFill = createElement(document, 'div', { className: 'tour-progress-fill' });
  progressTrack.append(progressFill);

  const quizOptions = createElement(document, 'div', { className: 'tour-quiz', attributes: { hidden: '' } });
  quizOptions.hidden = true;
  const quizFeedback = createElement(document, 'p', {
    className: 'tour-quiz-feedback',
    attributes: { 'aria-live': 'polite' },
  });

  const skipButton = createElement(document, 'button', {
    className: 'button button-secondary tour-skip',
    text: 'Pular tutorial',
    attributes: { type: 'button' },
  });
  const previousButton = createElement(document, 'button', {
    className: 'button button-secondary tour-previous',
    text: 'Anterior',
    attributes: { type: 'button' },
  });
  const nextButton = createElement(document, 'button', {
    className: 'button button-primary tour-next',
    text: 'Próximo',
    attributes: { type: 'button' },
  });
  const actions = createElement(document, 'div', { className: 'tour-actions' });
  actions.append(skipButton, previousButton, nextButton);

  const card = createElement(document, 'div', { className: 'tour-card' });
  const arrow = createElement(document, 'span', { className: 'tour-arrow', attributes: { 'aria-hidden': 'true' } });
  card.append(arrow, heading, title, body, progressTrack, quizOptions, quizFeedback, actions);

  const ring = createElement(document, 'div', { className: 'tour-ring', attributes: { 'aria-hidden': 'true' } });
  const backdrop = createElement(document, 'div', { className: 'tour-backdrop', attributes: { 'aria-hidden': 'true' } });
  const element = createElement(document, 'div', {
    className: 'tour-overlay tour-overlay--flat',
    attributes: {
      role: 'dialog',
      'aria-modal': 'false',
      'aria-labelledby': 'tour-title',
      'aria-describedby': 'tour-description',
      hidden: '',
    },
  });
  element.hidden = true;
  element.append(backdrop, ring, card);

  const stepCount = steps.length;
  let index = 0;
  let active = false;
  let highlighted;
  let highlightedListener;
  let quizAnswered = false;
  let previousFocus;

  function clearHighlight() {
    removeClassName(highlighted, highlightClass);
    if (highlighted && highlightedListener && typeof highlighted.removeEventListener === 'function') {
      highlighted.removeEventListener('click', highlightedListener);
    }
    highlighted = undefined;
    highlightedListener = undefined;
  }

  function applySpotlight(target) {
    const rect = typeof target?.getBoundingClientRect === 'function'
      ? target.getBoundingClientRect()
      : null;
    const style = element.style;
    if (!rect || !style || typeof style.setProperty !== 'function') {
      element.className = 'tour-overlay tour-overlay--flat';
      return;
    }
    const pad = 8;
    const viewportWidth = Number(globalThis.innerWidth) || rect.right + pad;
    const top = Math.max(rect.top - pad, 4);
    const left = Math.max(rect.left - pad, 4);
    const width = Math.max(Math.min(rect.width + pad * 2, viewportWidth - left - 4), 24);
    const height = Math.max(rect.height + pad * 2, 24);
    style.setProperty('--tour-top', `${top}px`);
    style.setProperty('--tour-left', `${left}px`);
    style.setProperty('--tour-width', `${width}px`);
    style.setProperty('--tour-height', `${height}px`);

    const cardWidth = Math.min(560, Math.max(viewportWidth - 24, 240));
    const cardLeft = (viewportWidth - cardWidth) / 2;
    const targetCenter = rect.left + rect.width / 2;
    const arrowLeft = Math.min(Math.max(targetCenter - cardLeft, 24), cardWidth - 24);
    style.setProperty('--tour-arrow-offset', `${Math.round(arrowLeft - cardWidth / 2)}px`);

    element.className = 'tour-overlay tour-overlay--positioned';
  }

  function highlightTarget(step, target) {
    if (!target) return;
    addClassName(target, highlightClass);
    highlighted = target;
    applySpotlight(target);
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (step.interactive !== false && typeof target.addEventListener === 'function') {
      highlightedListener = () => {
        if (typeof step.onActivate === 'function') step.onActivate();
        next();
      };
      target.addEventListener('click', highlightedListener);
    }
  }

  function renderQuiz(step) {
    quizAnswered = false;
    quizFeedback.textContent = '';
    quizFeedback.className = 'tour-quiz-feedback';
    if (!step.quiz) {
      quizOptions.hidden = true;
      quizOptions.setAttribute('hidden', '');
      quizOptions.replaceChildren();
      return;
    }
    const question = createElement(document, 'p', { className: 'tour-quiz-question', text: step.quiz.question });
    const buttons = step.quiz.options.map((option, optionIndex) => {
      const button = createElement(document, 'button', {
        className: 'button button-secondary tour-quiz-option',
        text: option.label,
        attributes: { type: 'button' },
      });
      button.addEventListener('click', () => answerQuiz(optionIndex));
      return button;
    });
    quizOptions.replaceChildren(question, ...buttons);
    quizOptions.hidden = false;
    quizOptions.removeAttribute('hidden');
  }

  function answerQuiz(optionIndex) {
    const step = steps[index];
    if (!step?.quiz || quizAnswered) return;
    const option = step.quiz.options[optionIndex];
    if (!option) return;
    quizAnswered = true;
    const buttons = quizOptions.children.slice(1);
    buttons.forEach((button, buttonIndex) => {
      const optionState = step.quiz.options[buttonIndex];
      const state = optionState?.correct
        ? 'correct'
        : (buttonIndex === optionIndex ? 'wrong' : 'muted');
      addClassName(button, `tour-quiz-option--${state}`);
      button.disabled = true;
    });
    quizFeedback.textContent = option.correct
      ? (step.quiz.correctMessage ?? 'Isso mesmo!')
      : (step.quiz.incorrectMessage ?? `Quase! A resposta certa é: ${step.quiz.options.find((item) => item.correct)?.label ?? ''}`);
    quizFeedback.className = option.correct ? 'tour-quiz-feedback tour-quiz-feedback--correct' : 'tour-quiz-feedback tour-quiz-feedback--wrong';
    if (typeof nextButton.focus === 'function') nextButton.focus();
  }

  function render() {
    const step = steps[index];
    if (!step) return;
    clearHighlight();
    progress.textContent = `Passo ${index + 1} de ${stepCount}`;
    title.textContent = step.title;
    description.textContent = step.description;
    const nextIcon = createIcon(document, step.icon);
    heading.replaceChildren(nextIcon, progress);
    mockupHolder.replaceChildren(createMockup(document, step.mockup));
    const completion = Math.round(((index + 1) / stepCount) * 100);
    if (element.style && typeof element.style.setProperty === 'function') {
      element.style.setProperty('--tour-progress', `${completion}%`);
    }
    progressFill.className = `tour-progress-fill tour-progress-fill--${completion}`;
    previousButton.disabled = index === 0;
    const lastStep = index === stepCount - 1;
    nextButton.textContent = lastStep ? 'Concluir' : 'Próximo';
    nextButton.hidden = false;
    renderQuiz(step);
    const target = typeof step.target === 'function' ? step.target() : undefined;
    highlightTarget(step, target);
    const focusTarget = step.interactive !== false && isFocusable(target) ? target : nextButton;
    if (typeof focusTarget?.focus === 'function') focusTarget.focus();
  }

  function start(stepIndex = 0) {
    if (!stepCount) return;
    active = true;
    previousFocus = document?.activeElement ?? undefined;
    index = Math.min(Math.max(stepIndex, 0), stepCount - 1);
    element.hidden = false;
    element.removeAttribute('hidden');
    render();
  }

  function stop({ finished = true } = {}) {
    active = false;
    clearHighlight();
    element.hidden = true;
    element.setAttribute('hidden', '');
    if (typeof previousFocus?.focus === 'function') previousFocus.focus();
    previousFocus = undefined;
    if (finished) {
      markTourSeen(storageKey);
      onFinish?.();
    }
  }

  function next() {
    if (!active) return;
    const step = steps[index];
    if (step?.quiz && !quizAnswered) {
      quizFeedback.textContent = 'Escolha uma resposta para continuar.';
      quizFeedback.className = 'tour-quiz-feedback tour-quiz-feedback--wrong';
      return;
    }
    if (index >= stepCount - 1) {
      stop({ finished: true });
      return;
    }
    index += 1;
    render();
  }

  function previous() {
    if (!active || index === 0) return;
    index -= 1;
    render();
  }

  skipButton.addEventListener('click', () => stop({ finished: true }));
  previousButton.addEventListener('click', previous);
  nextButton.addEventListener('click', next);

  return {
    element,
    card,
    backdrop,
    ring,
    arrow,
    icon,
    mockup: mockupHolder,
    progress,
    progressTrack,
    progressFill,
    title,
    description,
    quizOptions,
    quizFeedback,
    nextButton,
    previousButton,
    skipButton,
    start,
    stop,
    next,
    previous,
    answerQuiz,
    isActive: () => active,
    isQuizAnswered: () => quizAnswered,
    currentIndex: () => index,
    stepCount,
  };
}