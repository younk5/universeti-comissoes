import { parseMoneyToCents, parsePercentageToBasisPoints } from './validation.js';

const productFields = new Set(['name', 'commissionType', 'commissionInput']);

function requireProductObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Dados do produto inválidos.');
  }
  if (Object.keys(input).some((field) => !productFields.has(field))) {
    throw new Error('Dados do produto inválidos.');
  }
}

function productName(value) {
  const name = String(value ?? '').trim();
  if (name.length < 1 || name.length > 200) {
    throw new Error('Informe um nome de produto entre 1 e 200 caracteres.');
  }
  return name;
}

function commissionType(value) {
  if (!['fixed', 'percentage'].includes(value)) {
    throw new Error('Informe um tipo de comissão válido.');
  }
  return value;
}

export function validateProductInput(input) {
  requireProductObject(input);
  const type = commissionType(input.commissionType);
  const name = productName(input.name);
  if (!Object.hasOwn(input, 'commissionInput')) {
    throw new Error('Informe o valor da comissão.');
  }

  return {
    name,
    commissionType: type,
    commissionRateBps: type === 'percentage' ? parsePercentageToBasisPoints(input.commissionInput) : null,
    commissionFixedCents: type === 'fixed' ? parseMoneyToCents(input.commissionInput) : null,
  };
}

export function validateProductUpdate(input, current) {
  requireProductObject(input);
  if (Object.keys(input).length === 0) throw new Error('Dados do produto inválidos.');
  if (Object.hasOwn(input, 'commissionType') && !Object.hasOwn(input, 'commissionInput')
    && input.commissionType !== current.commissionType) {
    throw new Error('Informe o valor da comissão.');
  }

  return validateProductInput({
    name: Object.hasOwn(input, 'name') ? input.name : current.name,
    commissionType: Object.hasOwn(input, 'commissionType') ? input.commissionType : current.commissionType,
    commissionInput: Object.hasOwn(input, 'commissionInput') ? input.commissionInput : current.commissionInput,
  });
}

function centsToDecimalString(value) {
  const cents = BigInt(value);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function serializeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    commissionType: row.commission_type,
    commissionInput: row.commission_type === 'percentage'
      ? Number(row.commission_rate_bps) / 100
      : centsToDecimalString(row.commission_fixed_cents),
    active: row.active === true,
  };
}
