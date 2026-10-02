import { parseMoneyToCents, parsePercentageToBasisPoints } from './validation.js';

function integerToDecimalString(value) {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}

export function serializeDefaultCommissionRule(row) {
  if (row?.configured !== true) return null;
  return {
    commissionType: row.commission_type,
    commissionInput: row.commission_type === 'percentage'
      ? integerToDecimalString(row.commission_rate_bps)
      : integerToDecimalString(row.commission_fixed_cents),
  };
}

export function validateDefaultCommissionRuleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((field) => !['commissionType', 'commissionInput'].includes(field))) {
    throw new Error('Dados da regra padrão inválidos.');
  }
  if (!['fixed', 'percentage'].includes(input.commissionType)) {
    throw new Error('Informe um tipo de comissão válido.');
  }
  if (!Object.hasOwn(input, 'commissionInput')) {
    throw new Error('Informe o valor da comissão.');
  }
  return {
    commissionType: input.commissionType,
    commissionRateBps: input.commissionType === 'percentage'
      ? parsePercentageToBasisPoints(input.commissionInput)
      : null,
    commissionFixedCents: input.commissionType === 'fixed'
      ? parseMoneyToCents(input.commissionInput)
      : null,
  };
}
