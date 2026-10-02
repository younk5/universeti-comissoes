import { parseMoneyToCents, parsePercentageToBasisPoints } from './validation.js';

function centsToDecimalString(value) {
  const cents = BigInt(value);
  const sign = cents < 0n ? '-' : '';
  const absoluteCents = cents < 0n ? -cents : cents;
  return `${sign}${absoluteCents / 100n}.${(absoluteCents % 100n).toString().padStart(2, '0')}`;
}

function commissionValueToCents(value) {
  if (value === 0 || value === 0n || value === '0' || value === '0.00') return 0n;
  return BigInt(parseMoneyToCents(value));
}

function centsToLegacyNumber(value) {
  // Compatibility boundary for legacy callers; never use for view or aggregate output.
  return Number(value) / 100;
}

export function serializeCommission(row) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name_snapshot,
    productId: row.product_id ?? null,
    product: row.product,
    saleValue: centsToDecimalString(row.sale_value_cents),
    commissionType: row.commission_type,
    commissionInput: row.commission_type === 'percentage'
      ? Number(row.commission_rate_bps) / 100
      : centsToDecimalString(row.commission_fixed_cents),
    commissionValue: centsToDecimalString(row.commission_value_cents),
    saleDate: row.sale_date,
    paymentStatus: row.status,
    paidAt: row.paid_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function calculateCommissionCents({
  saleValueCents,
  commissionType,
  commissionRateBps,
  commissionFixedCents,
}) {
  if (commissionType === 'percentage') {
    const numerator = BigInt(saleValueCents) * BigInt(commissionRateBps);
    return Number((numerator + 5000n) / 10000n);
  }
  if (commissionType === 'fixed') return commissionFixedCents;
  throw new Error('Tipo de comissão inválido.');
}

export function calculateCommission({ saleValue, commissionType, commissionInput }) {
  const saleValueCents = parseMoneyToCents(saleValue);
  if (commissionType === 'percentage') {
    return centsToLegacyNumber(calculateCommissionCents({
      saleValueCents,
      commissionType,
      commissionRateBps: parsePercentageToBasisPoints(commissionInput),
      commissionFixedCents: null,
    }));
  }
  if (commissionType === 'fixed') {
    return centsToLegacyNumber(calculateCommissionCents({
      saleValueCents,
      commissionType,
      commissionRateBps: null,
      commissionFixedCents: parseMoneyToCents(commissionInput),
    }));
  }
  throw new Error('Tipo de comissão inválido.');
}

export function summarizeCommissions(items) {
  const totalsCents = items.reduce((totals, item) => ({
    pendingTotal: totals.pendingTotal + (item.paymentStatus === 'pending' ? commissionValueToCents(item.commissionValue) : 0n),
    paidTotal: totals.paidTotal + (item.paymentStatus === 'paid' ? commissionValueToCents(item.commissionValue) : 0n),
  }), { pendingTotal: 0n, paidTotal: 0n });
  return {
    pendingTotal: centsToDecimalString(totalsCents.pendingTotal),
    paidTotal: centsToDecimalString(totalsCents.paidTotal),
  };
}

export function buildMonthlyPaidSeries(items) {
  const totalsByMonth = new Map();
  for (const item of items) {
    if (item.paymentStatus !== 'paid') continue;
    const month = item.saleDate.slice(0, 7);
    totalsByMonth.set(month, (totalsByMonth.get(month) ?? 0n) + commissionValueToCents(item.commissionValue));
  }
  return [...totalsByMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, totalCents]) => ({ month, total: centsToDecimalString(totalCents) }));
}
