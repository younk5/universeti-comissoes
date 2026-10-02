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

export function helpStorageKey(scope) {
  return `galaxy-smart-help-mode:${scope}`;
}

function readEnabled(storageKey) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    return storage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function writeEnabled(storageKey, value) {
  try {
    globalThis.localStorage?.setItem(storageKey, value ? 'true' : 'false');
  } catch {
    // Storage can be unavailable; the toggle simply does not persist.
  }
}

export function createHelpMode(document, { storageKey, container } = {}) {
  const tooltip = createElement(document, 'div', {
    className: 'help-tooltip',
    attributes: { id: 'help-tooltip', role: 'tooltip', hidden: '' },
  });
  tooltip.hidden = true;

  const button = createElement(document, 'button', {
    className: 'button button-secondary help-toggle',
    text: 'Dicas',
    attributes: { type: 'button', 'aria-pressed': 'false' },
  });

  let enabled = readEnabled(storageKey);
  let visibleFor;

  function applyButtonState() {
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.textContent = enabled ? 'Dicas ligadas' : 'Dicas';
    if (enabled) addClassName(button, 'help-toggle--on');
    else removeClassName(button, 'help-toggle--on');
  }

  function hide() {
    const control = visibleFor;
    visibleFor = undefined;
    if (control && typeof control.removeAttribute === 'function') {
      control.removeAttribute('aria-describedby');
    }
    tooltip.hidden = true;
    tooltip.setAttribute('hidden', '');
    removeClassName(tooltip, 'help-tooltip--visible');
    removeClassName(tooltip, 'help-tooltip--floating');
    removeClassName(tooltip, 'help-tooltip--inline');
  }

  function place(element) {
    const rect = typeof element?.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : null;
    const style = tooltip.style;
    if (!rect || !style || typeof style.setProperty !== 'function') {
      addClassName(tooltip, 'help-tooltip--inline');
      return;
    }
    addClassName(tooltip, 'help-tooltip--floating');
    style.setProperty('--help-left', `${Math.round(rect.left)}px`);
    style.setProperty('--help-top', `${Math.round(rect.bottom + 8)}px`);
    style.setProperty('--help-width', `${Math.round(rect.width)}px`);
  }

  function show(element) {
    const text = element?.getAttribute?.('data-help') ?? '';
    if (!text) return;
    visibleFor = element;
    if (typeof element.setAttribute === 'function') {
      element.setAttribute('aria-describedby', 'help-tooltip');
    }
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.removeAttribute('hidden');
    addClassName(tooltip, 'help-tooltip--visible');
    place(element);
  }

  function register(element, text) {
    if (!element || !text) return;
    element.setAttribute('data-help', text);
  }

  function setEnabled(value) {
    enabled = value === true;
    applyButtonState();
    writeEnabled(storageKey, enabled);
    if (!enabled) hide();
  }

  function toggle() {
    setEnabled(!enabled);
  }

  function controlFrom(event) {
    const target = event?.target;
    if (typeof target?.closest !== 'function') return undefined;
    const control = target.closest('[data-help]');
    return control ?? undefined;
  }

  function handlePointerOver(event) {
    if (!enabled) return;
    const control = controlFrom(event);
    if (control) show(control);
  }

  function handlePointerOut(event) {
    if (!enabled) return;
    const control = controlFrom(event);
    if (control && control === visibleFor) hide();
  }

  button.addEventListener('click', toggle);
  container?.addEventListener('mouseover', handlePointerOver);
  container?.addEventListener('mouseout', handlePointerOut);
  container?.addEventListener('focusin', handlePointerOver);
  container?.addEventListener('focusout', handlePointerOut);

  applyButtonState();

  return {
    button,
    tooltip,
    register,
    show,
    hide,
    setEnabled,
    toggle,
    isEnabled: () => enabled,
    handlePointerOver,
    handlePointerOut,
  };
}