const connectionErrorMessage = 'Não foi possível conectar ao servidor. Tente novamente.';
const defaultErrorMessage = 'Não foi possível concluir a operação.';

function hasAccessToken(token) {
  return typeof token === 'string' && token.trim();
}

async function errorMessage(response, fallback = defaultErrorMessage) {
  try {
    const data = await response.json();
    return typeof data?.message === 'string' ? data.message : fallback;
  } catch {
    return fallback;
  }
}

export function createApiClient({
  getAccessToken = () => undefined,
  refreshSession = async () => false,
  onUnauthorized = () => {},
  fetchImpl = globalThis.fetch,
} = {}) {
  let refreshPromise;
  let unauthorizedPromise;

  async function currentAccessToken() {
    try {
      const token = await getAccessToken();
      return hasAccessToken(token) ? token : undefined;
    } catch {
      return undefined;
    }
  }

  async function send(path, options) {
    const headers = { ...(options.headers ?? {}) };
    delete headers.Authorization;
    const token = await currentAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      return {
        response: await fetchImpl(path, {
          ...options,
          credentials: 'same-origin',
          headers,
        }),
        token,
      };
    } catch {
      throw new Error(connectionErrorMessage);
    }
  }

  async function refreshOnce() {
    if (!refreshPromise) {
      refreshPromise = Promise.resolve()
        .then(refreshSession)
        .then((result) => result !== false)
        .catch(() => false)
        .finally(() => {
          refreshPromise = undefined;
        });
    }
    return refreshPromise;
  }

  async function notifyUnauthorized() {
    if (!unauthorizedPromise) {
      unauthorizedPromise = Promise.resolve()
        .then(onUnauthorized)
        .catch(() => {})
        .finally(() => {
          unauthorizedPromise = undefined;
        });
    }
    await unauthorizedPromise;
  }

  async function responseWithSingleRefresh(path, options) {
    let attempt = await send(path, options);
    let { response } = attempt;
    if (response.status !== 401) return response;

    const tokenChangedSinceAttempt = (await currentAccessToken()) !== attempt.token;
    if (tokenChangedSinceAttempt || await refreshOnce()) {
      attempt = await send(path, options);
      response = attempt.response;
      if (response.status !== 401) return response;
    }

    await notifyUnauthorized();
    return response;
  }

  async function request(path, options = {}) {
    const response = await responseWithSingleRefresh(path, options);
    if (response.status === 204) return undefined;
    if (!response.ok) throw new Error(await errorMessage(response));

    try {
      return await response.json();
    } catch {
      throw new Error(defaultErrorMessage);
    }
  }

  async function download(path, options = {}) {
    const response = await responseWithSingleRefresh(path, options);
    if (!response.ok) throw new Error(await errorMessage(response));

    try {
      return await response.blob();
    } catch {
      throw new Error('Não foi possível baixar o arquivo. Tente novamente.');
    }
  }

  return {
    request,
    get: (path, options = {}) => request(path, { ...options, method: options.method ?? 'GET' }),
    download,
  };
}
