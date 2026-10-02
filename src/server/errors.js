export class AppError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sessão inválida ou expirada.') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
    this.name = 'UnauthorizedError';
  }
}

export function errorHandler(error, request, response, _next) {
  const hasKnownStatus = Number.isInteger(error.status);
  const status = hasKnownStatus ? error.status : 500;
  const message = hasKnownStatus ? error.message : 'Não foi possível concluir a operação.';

  if (!hasKnownStatus) {
    console.error('[api-error]', {
      method: request.method,
      path: request.originalUrl ?? request.path,
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });
  }

  const code = hasKnownStatus ? error.code : undefined;
  return response.status(status).json(code === undefined ? { message } : { message, code });
}
