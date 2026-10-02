import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeDefaultCommissionRule,
  validateDefaultCommissionRuleInput,
} from '../../src/server/domain/default-commission-rule.js';
import { createDefaultCommissionRuleService } from '../../src/server/services/default-commission-rule-service.js';

test('validateDefaultCommissionRuleInput converts Brazilian fixed money to exact cents', () => {
  assert.deepEqual(validateDefaultCommissionRuleInput({
    commissionType: 'fixed', commissionInput: '20,00',
  }), {
    commissionType: 'fixed', commissionRateBps: null, commissionFixedCents: 2000,
  });
});

test('serializeDefaultCommissionRule returns exact decimal strings or null for an unconfigured rule', () => {
  assert.deepEqual(serializeDefaultCommissionRule({
    configured: true,
    commission_type: 'percentage',
    commission_rate_bps: 1250,
    commission_fixed_cents: null,
  }), { commissionType: 'percentage', commissionInput: '12.50' });
  assert.equal(serializeDefaultCommissionRule({ configured: false }), null);
});

test('validateDefaultCommissionRuleInput converts percentage values to exact basis points', () => {
  assert.deepEqual(validateDefaultCommissionRuleInput({
    commissionType: 'percentage', commissionInput: '12,50',
  }), {
    commissionType: 'percentage', commissionRateBps: 1250, commissionFixedCents: null,
  });
});

test('default commission rule service rejects non-active-administrator actors before database access', async () => {
  let databaseCalls = 0;
  const service = createDefaultCommissionRuleService({
    adminClient: { from: () => { databaseCalls += 1; throw new Error('database must not be called'); } },
  });

  for (const actor of [
    { id: 'seller-1', role: 'seller', active: true },
    { id: 'admin-2', role: 'admin', active: false },
  ]) {
    await assert.rejects(
      () => service.list({ actor }),
      (error) => error.status === 403 && error.code === 'ADMIN_REQUIRED',
    );
  }
  assert.equal(databaseCalls, 0);
});

test('default commission rule service lists the protected rule with an explicit field projection', async () => {
  let selectedColumns;
  const service = createDefaultCommissionRuleService({
    adminClient: {
      from(table) {
        assert.equal(table, 'commission_default_rule');
        return {
          select(columns) {
            selectedColumns = columns;
            return {
              maybeSingle: async () => ({
                data: {
                  configured: true,
                  commission_type: 'percentage',
                  commission_rate_bps: 1250,
                  commission_fixed_cents: null,
                },
                error: null,
              }),
            };
          },
        };
      },
    },
  });

  assert.deepEqual(await service.list({ actor: { id: 'admin-1', role: 'admin', active: true } }), {
    commissionType: 'percentage', commissionInput: '12.50',
  });
  assert.equal(selectedColumns, 'configured, commission_type, commission_rate_bps, commission_fixed_cents');
});

test('default commission rule service updates through the actor-bound locking RPC with exact integers', async () => {
  const calls = [];
  const service = createDefaultCommissionRuleService({
    adminClient: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: [{ recalculated_pending_count: 3 }], error: null };
      },
    },
  });

  assert.deepEqual(await service.update({
    actor: { id: 'admin-1', role: 'admin', active: true },
    input: { commissionType: 'fixed', commissionInput: '20,00' },
  }), {
    commissionType: 'fixed', commissionInput: '20.00', recalculatedPendingCount: 3,
  });
  assert.deepEqual(calls, [{
    name: 'update_default_commission_rule',
    args: {
      p_actor_id: 'admin-1',
      p_commission_type: 'fixed',
      p_commission_rate_bps: null,
      p_commission_fixed_cents: 2000,
    },
  }]);
});

test('default commission rule service turns invalid or forged rule bodies into public validation errors', async () => {
  const service = createDefaultCommissionRuleService({
    adminClient: { rpc: async () => { throw new Error('RPC must not be called'); } },
  });

  for (const input of [
    { commissionType: 'fixed' },
    { commissionType: 'fixed', commissionInput: '20', forged: true },
  ]) {
    await assert.rejects(
      () => service.update({ actor: { id: 'admin-1', role: 'admin', active: true }, input }),
      (error) => error.status === 400 && error.code === 'INVALID_DEFAULT_COMMISSION_RULE',
    );
  }
});
