export function normalizeIdentifier(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

export function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < 6) {
    throw new Error('A senha deve ter pelo menos 6 caracteres.');
  }
  return password;
}

const MAX_MONEY_CENTS = 900000000000000;
const MAX_BASIS_POINTS = 10000;

function expandExponentialNotation(raw) {
  const match = /^(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(raw);
  if (!match) return raw;

  const [, integer, fraction = '', exponentText] = match;
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + Number(exponentText);
  if (decimalIndex <= 0) return `0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function decimalText(value, label) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Informe ${label} válido.`);
  }

  const raw = typeof value === 'number'
    ? expandExponentialNotation(String(value))
    : String(value ?? '').trim();

  if (!raw) throw new Error(`Informe ${label} válido.`);
  if (raw.includes(',')) {
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(raw)) {
      throw new Error(`Informe ${label} válido.`);
    }
    return raw.replace(/\./g, '').replace(',', '.');
  }
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`Informe ${label} válido.`);
  return raw;
}

function parsePositiveDecimal(value, { label, maximum }) {
  const [integer, fraction = ''] = decimalText(value, label).split('.');
  if (fraction.length > 2) {
    throw new Error(`Informe ${label} com no máximo duas casas decimais.`);
  }

  const scaled = (BigInt(integer) * 100n) + BigInt(fraction.padEnd(2, '0') || '0');
  if (scaled <= 0n) throw new Error(`O ${label} deve ser maior que zero.`);
  if (scaled > BigInt(maximum)) throw new Error(`O ${label} excede o máximo permitido.`);
  return Number(scaled);
}

export function parseMoneyToCents(value) {
  return parsePositiveDecimal(value, { label: 'valor', maximum: MAX_MONEY_CENTS });
}

export function parsePercentageToBasisPoints(value) {
  return parsePositiveDecimal(value, { label: 'percentual', maximum: MAX_BASIS_POINTS });
}

export function parseMoney(value) {
  try {
    return parseMoneyToCents(value) / 100;
  } catch {
    throw new Error('Informe um valor positivo.');
  }
}

function requireText(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

function validateSaleDate(value) {
  const date = requireText(value, 'Informe a data da venda.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Informe uma data de venda válida.');
  }
  return date;
}

export function normalizeProductId(value) {
  const productId = String(value ?? '').trim() || null;
  if (productId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
    throw new Error('Informe um identificador de produto válido.');
  }
  return productId;
}

export function validateCommissionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Dados da comissão inválidos.');
  }
  if (['paid', 'voided'].includes(input.paymentStatus ?? input.status)) {
    throw new Error('Comissões pagas ou anuladas não podem ser alteradas.');
  }

  const productId = normalizeProductId(input.productId);
  return {
    sellerId: requireText(input.sellerId, 'Informe o vendedor.'),
    productId,
    product: productId
      ? String(input.product ?? '').trim()
      : requireText(input.product, 'Informe o produto ou serviço.'),
    saleValue: parseMoney(input.saleValue),
    saleDate: validateSaleDate(input.saleDate),
    note: String(input.note ?? '').trim(),
  };
}
