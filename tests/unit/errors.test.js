import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, errorHandler } from '../../src/server/errors.js';

test('AppError preserva mensagem, status e código públicos', () => {
  const error = new AppError('Conflito de comissão.', { status: 409, code: 'COMMISSION_CONFLICT' });

  assert.ok(error instanceof Error);
  assert.equal(error.message, 'Conflito de comissão.');
  assert.equal(error.status, 409);
  assert.equal(error.code, 'COMMISSION_CONFLICT');
});

test('errorHandler retorna erro conhecido como JSON', () => {
  let status;
  let body;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
    },
  };

  errorHandler(new AppError('Conflito de comissão.', { status: 409, code: 'COMMISSION_CONFLICT' }), {}, response);

  assert.equal(status, 409);
  assert.deepEqual(body, { message: 'Conflito de comissão.', code: 'COMMISSION_CONFLICT' });
});

test('errorHandler protege detalhes de erro sem status conhecido e registra somente metadados seguros', () => {
  let status;
  let body;
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
    },
  };

  try {
    errorHandler(new Error('detalhe interno'), {
      method: 'DELETE',
      originalUrl: '/api/admins/example-id',
      body: { password: 'never-log-this' },
    }, response);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(status, 500);
  assert.deepEqual(body, {
    message: 'Não foi possível concluir a operação.',
  });
  assert.deepEqual(logged, [[
    '[api-error]',
    {
      method: 'DELETE',
      path: '/api/admins/example-id',
      name: 'Error',
      code: undefined,
      message: 'detalhe interno',
    },
  ]]);
});
