export const connectionErrorMessage = 'Não foi possível conectar ao servidor. Tente novamente.';
const sessionErrorMessage = 'Sua sessão expirou. Entre novamente.';

function accessTokenFrom(payload) {
  return typeof payload?.accessToken === 'string' && payload.accessToken.trim()
    ? payload.accessToken
    : undefined;
}

export function createSessionClient({ fetchImpl = globalThis.fetch } = {}) {
  let accessToken;

  function clear() {
    accessToken = undefined;
  }

  async function establishSession(path, options) {
    let response;
    try {
      response = await fetchImpl(path, options);
    } catch {
      clear();
      throw new Error(connectionErrorMessage);
    }

    if (!response.ok) {
      clear();
      throw new Error(sessionErrorMessage);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      clear();
      throw new Error(sessionErrorMessage);
    }

    const nextAccessToken = accessTokenFrom(payload);
    if (!nextAccessToken) {
      clear();
      throw new Error(sessionErrorMessage);
    }

    accessToken = nextAccessToken;
    return payload.actor;
  }

  return {
    async login({ identifier, password }) {
      return establishSession('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
    },

    async restore() {
      return establishSession('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
    },

    async logout() {
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      try {
        const response = await fetchImpl('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers,
        });
        if (!response.ok) throw new Error('logout failed');
      } catch {
        throw new Error(connectionErrorMessage);
      } finally {
        clear();
      }
    },

    getAccessToken() {
      return accessToken;
    },

    clear,
  };
}
