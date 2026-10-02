import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

async function getAvailablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForHealth(port, { timeoutMs, stderr }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
  }

  throw new Error(
    ['Servidor não respondeu ao health check.', stderr().trim()].filter(Boolean).join('\n'),
    { cause: lastError },
  );
}

test('waitForHealth inclui o diagnóstico do processo quando expira', async () => {
  const port = await getAvailablePort();
  const failedProcess = spawn(process.execPath, ['-e', "console.error('Falha controlada de inicialização.'); process.exit(1);"], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  failedProcess.stderr.setEncoding('utf8');
  failedProcess.stderr.on('data', (chunk) => { stderr += chunk; });
  await once(failedProcess, 'close');

  await assert.rejects(
    waitForHealth(port, {
      timeoutMs: 25,
      stderr: () => stderr,
    }),
    {
      message: 'Servidor não respondeu ao health check.\nFalha controlada de inicialização.',
    },
  );
});

test('server.js inicia o health check na porta configurada', { timeout: 10_000 }, async (context) => {
  const port = await getAvailablePort();
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { stderr += chunk; });

  context.after(() => {
    server.kill();
  });

  const response = await waitForHealth(port, { timeoutMs: 7_500, stderr: () => stderr });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
