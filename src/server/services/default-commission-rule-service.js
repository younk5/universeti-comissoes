import { AppError } from '../errors.js';
import { serializeDefaultCommissionRule, validateDefaultCommissionRuleInput } from '../domain/default-commission-rule.js';

const defaultRuleColumns = 'configured, commission_type, commission_rate_bps, commission_fixed_cents';

function requireAdmin(actor) {
  if (actor?.role !== 'admin' || actor.active !== true) {
    throw new AppError('Acesso permitido somente à administração.', { status: 403, code: 'ADMIN_REQUIRED' });
  }
}

function invalidDefaultCommissionRule(message) {
  return new AppError(message, { status: 400, code: 'INVALID_DEFAULT_COMMISSION_RULE' });
}

function validDefaultCommissionRuleInput(input) {
  try {
    return validateDefaultCommissionRuleInput(input);
  } catch (error) {
    throw invalidDefaultCommissionRule(error.message);
  }
}

export function createDefaultCommissionRuleService({ adminClient }) {
  return {
    async list({ actor }) {
      requireAdmin(actor);
      const { data, error } = await adminClient.from('commission_default_rule')
        .select(defaultRuleColumns)
        .maybeSingle();
      if (error) throw error;
      return serializeDefaultCommissionRule(data);
    },

    async update({ actor, input }) {
      requireAdmin(actor);
      const values = validDefaultCommissionRuleInput(input);
      const { data, error } = await adminClient.rpc('update_default_commission_rule', {
        p_actor_id: actor.id,
        p_commission_type: values.commissionType,
        p_commission_rate_bps: values.commissionRateBps,
        p_commission_fixed_cents: values.commissionFixedCents,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      return {
        ...serializeDefaultCommissionRule({
          configured: true,
          commission_type: values.commissionType,
          commission_rate_bps: values.commissionRateBps,
          commission_fixed_cents: values.commissionFixedCents,
        }),
        recalculatedPendingCount: result?.recalculated_pending_count ?? 0,
      };
    },
  };
}
