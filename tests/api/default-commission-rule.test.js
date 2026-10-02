import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const admin = { id: 'admin-1', role: 'admin', active: true };

test('active administrator reads the default commission rule through the authenticated actor contract', async () => {
  const calls = [];
  const app = createApp({
    services: {
      auth: { verifyActor: async () => admin },
      defaultCommissionRule: {
        list: async (input) => {
          calls.push(input);
          return { commissionType: 'percentage', commissionInput: '12.50' };
        },
      },
    },
    config: { nodeEnv: 'test' },
  });

  const response = await request(app)
    .get('/api/commission-default-rule')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { commissionType: 'percentage', commissionInput: '12.50' });
  assert.deepEqual(calls, [{ actor: admin }]);
});

test('active administrator updates the default rule with only rule fields and the authenticated actor', async () => {
  const calls = [];
  const app = createApp({
    services: {
      auth: { verifyActor: async () => admin },
      defaultCommissionRule: {
        update: async (input) => {
          calls.push(input);
          return { commissionType: 'fixed', commissionInput: '20.00', recalculatedPendingCount: 3 };
        },
      },
    },
    config: { nodeEnv: 'test' },
  });

  const response = await request(app)
    .put('/api/commission-default-rule')
    .set('Authorization', 'Bearer token')
    .send({ commissionType: 'fixed', commissionInput: '20', actorId: 'forged', unexpected: 'forged' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    commissionType: 'fixed', commissionInput: '20.00', recalculatedPendingCount: 3,
  });
  assert.deepEqual(calls, [{
    actor: admin,
    input: { commissionType: 'fixed', commissionInput: '20' },
  }]);
});
