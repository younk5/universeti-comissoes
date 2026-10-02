function createElement(document, tagName, { className, text, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

export function checklistStorageKey(scope) {
  return `galaxy-smart-checklist:${scope}`;
}

function readDone(storageKey) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return [];
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeDone(storageKey, ids) {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable; progress simply does not persist.
  }
}

export function createChecklist(document, { storageKey, items = [] } = {}) {
  const title = createElement(document, 'h3', {
    className: 'checklist-title',
    text: 'Primeiros passos',
    attributes: { id: 'checklist-title' },
  });
  const progress = createElement(document, 'p', {
    className: 'checklist-progress',
    attributes: { 'aria-live': 'polite' },
  });
  const list = createElement(document, 'ul', { className: 'checklist-items' });
  const element = createElement(document, 'section', {
    className: 'checklist',
    attributes: { 'aria-labelledby': 'checklist-title' },
  });
  element.append(title, progress, list);

  const done = new Set(readDone(storageKey));

  function render() {
    const rows = items.map((item) => {
      const complete = done.has(item.id);
      const row = createElement(document, 'li', {
        className: complete ? 'checklist-item checklist-item--done' : 'checklist-item',
      });
      const marker = createElement(document, 'span', {
        className: 'checklist-check',
        text: complete ? '✓' : '',
        attributes: { 'aria-hidden': 'true' },
      });
      const label = createElement(document, 'span', { className: 'checklist-label', text: item.label });
      row.append(marker, label);
      if (item.hint) {
        row.append(createElement(document, 'span', { className: 'checklist-hint', text: item.hint }));
      }
      return row;
    });
    list.replaceChildren(...rows);
    const completed = items.filter((item) => done.has(item.id)).length;
    progress.textContent = completed === items.length && items.length > 0
      ? 'Tudo pronto! Você já conhece o essencial.'
      : `${completed} de ${items.length} concluído(s)`;
    if (completed === items.length && items.length > 0) element.className = 'checklist checklist--complete';
    else element.className = 'checklist';
  }

  function complete(id) {
    if (!id || done.has(id)) return;
    if (!items.some((item) => item.id === id)) return;
    done.add(id);
    writeDone(storageKey, [...done]);
    render();
  }

  function reset() {
    done.clear();
    writeDone(storageKey, []);
    render();
  }

  render();

  return {
    element,
    title,
    progress,
    list,
    complete,
    reset,
    isComplete: (id) => done.has(id),
    completedCount: () => items.filter((item) => done.has(item.id)).length,
    itemCount: items.length,
  };
}