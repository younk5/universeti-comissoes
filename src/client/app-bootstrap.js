import { createApiClient } from './api-client.js';
import { createSessionClient } from './session-client.js';
import { renderLogin } from './views/login-view.js';
import { renderAdmin } from './views/admin-view.js';
import { renderSeller } from './views/seller-view.js';

function createElement(tagName, { className, text, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function renderNotice(root, title, message) {
  const main = createElement('main', {
    className: 'app-shell notice-shell',
    attributes: { 'aria-labelledby': 'notice-title' },
  });
  const panel = createElement('section', { className: 'notice-panel' });
  const logo = createElement('img', {
    className: 'brand-logo',
    attributes: {
      src: '/assets/universe-ti.svg',
      alt: 'Universe TI',
    },
  });
  const heading = createElement('h1', { text: title, attributes: { id: 'notice-title' } });
  const feedback = createElement('p', {
    className: 'form-feedback',
    text: message,
    attributes: { 'aria-live': 'polite' },
  });

  panel.append(logo, heading, feedback);
  main.append(panel);
  root.replaceChildren(main);
}

export async function bootstrap(root = document.querySelector('#app')) {
  if (!root) return;
  renderNotice(root, 'Controle de Comissões', 'Carregando acesso seguro.');

  const sessionClient = createSessionClient();
  let apiClient;
  let sessionExpired = false;

  const showLogin = (message = '') => {
    renderLogin(root, {
      message,
      sessionClient,
      onAuthenticated: async () => {
        const actor = await apiClient.request('/api/me');
        renderByRole(actor);
      },
    });
  };

  const signOut = async (message = '') => {
    try {
      await sessionClient.logout();
    } catch {
      // A limpeza local remove o conteúdo protegido mesmo sem rede.
    } finally {
      showLogin(message);
    }
  };

  apiClient = createApiClient({
    getAccessToken: sessionClient.getAccessToken,
    refreshSession: sessionClient.restore,
    onUnauthorized: () => {
      sessionExpired = true;
      sessionClient.clear();
      showLogin('Sua sessão expirou. Entre novamente.');
    },
  });

  const renderByRole = (actor) => {
    const renderers = {
      admin: () => renderAdmin(root, { api: apiClient, actor, onSignOut: signOut }),
      seller: () => renderSeller(root, { api: apiClient, actor, onSignOut: signOut }),
    };
    const render = renderers[actor?.role];
    if (!render) {
      signOut();
      return;
    }
    render();
  };

  try {
    await sessionClient.restore();
  } catch {
    showLogin();
    return;
  }

  try {
    const actor = await apiClient.request('/api/me');
    renderByRole(actor);
  } catch {
    if (!sessionExpired) showLogin();
  }
}
