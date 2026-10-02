import { connectionErrorMessage } from '../session-client.js';

function createElement(document, tagName, { className, text, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

export function renderLogin(root, { sessionClient, onAuthenticated = async () => {}, message = '' } = {}) {
  const document = root.ownerDocument ?? globalThis.document;
  const main = createElement(document, 'main', {
    className: 'app-shell login-shell',
    attributes: { 'aria-labelledby': 'login-title' },
  });
  const panel = createElement(document, 'section', {
    className: 'login-panel', attributes: { 'data-login-layout': 'modern' },
  });
  const brandSide = createElement(document, 'section', { className: 'login-brand-side' });
  const logo = createElement(document, 'img', {
    className: 'brand-logo',
    attributes: {
      src: '/assets/universe-ti.svg',
      alt: 'Universe TI',
    },
  });
  const brandTitle = createElement(document, 'p', { className: 'login-brand-title', text: 'Operação clara. Comissão sob controle.' });
  const brandDescription = createElement(document, 'p', {
    className: 'login-brand-description',
    text: 'Uma visão simples para acompanhar vendas, pagamentos e a equipe.',
  });
  brandSide.append(logo, brandTitle, brandDescription);
  const accessSide = createElement(document, 'section', { className: 'login-access-side' });
  const title = createElement(document, 'h1', { text: 'Controle de Comissões', attributes: { id: 'login-title' } });
  const description = createElement(document, 'p', {
    className: 'login-description',
    text: 'Entre para acessar sua área segura.',
  });
  const form = createElement(document, 'form', { className: 'login-form' });
  const identifierLabel = createElement(document, 'label', { text: 'Usuário', attributes: { for: 'identifier' } });
  const identifier = createElement(document, 'input', {
    className: 'form-control',
    attributes: {
      id: 'identifier',
      name: 'identifier',
      type: 'text',
      autocomplete: 'username',
      required: '',
    },
  });
  identifier.name = 'identifier';
  identifier.type = 'text';
  const passwordLabel = createElement(document, 'label', { text: 'Senha', attributes: { for: 'password' } });
  const password = createElement(document, 'input', {
    className: 'form-control',
    attributes: {
      id: 'password',
      name: 'password',
      type: 'password',
      autocomplete: 'current-password',
      minlength: '6',
      required: '',
    },
  });
  password.name = 'password';
  password.type = 'password';
  const feedback = createElement(document, 'p', {
    className: 'form-feedback',
    text: message,
    attributes: { id: 'login-feedback', 'aria-live': 'polite' },
  });
  const submitButton = createElement(document, 'button', {
    className: 'button button-primary',
    text: 'Entrar',
    attributes: { type: 'submit' },
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    feedback.setAttribute('data-state', '');
    submitButton.disabled = true;
    submitButton.textContent = 'Entrando…';

    try {
      const actor = await sessionClient.login({
        identifier: identifier.value.trim(),
        password: password.value,
      });
      await onAuthenticated(actor);
    } catch (error) {
      password.value = '';
      const connectionFailed = error instanceof Error && error.message === connectionErrorMessage;
      feedback.textContent = connectionFailed ? connectionErrorMessage : 'Usuário ou senha inválidos.';
      feedback.setAttribute('data-state', 'error');
      password.focus();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Entrar';
    }
  });

  form.append(identifierLabel, identifier, passwordLabel, password, feedback, submitButton);
  accessSide.append(title, description, form);
  panel.append(brandSide, accessSide);
  main.append(panel);
  root.replaceChildren(main);

  return { form, identifier, password, submitButton, feedback };
}
