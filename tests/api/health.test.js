import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

test('GET /health responde sem autenticação', async () => {
  const response = await request(createApp({ services: {}, config: { nodeEnv: 'test' } }))
    .get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});
