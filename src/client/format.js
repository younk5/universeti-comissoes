const integerFormatter = new Intl.NumberFormat('pt-BR', {
  useGrouping: true,
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
});

function moneyParts(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new TypeError('Valor monetário inválido.');
  const [, sign, integerPart, fractionalPart = ''] = match;
  return { sign, integerPart, fractionalPart: fractionalPart.padEnd(2, '0') };
}

function moneyToCents(value) {
  const { sign, integerPart, fractionalPart } = moneyParts(value);
  const cents = BigInt(integerPart) * 100n + BigInt(fractionalPart);
  return sign ? -cents : cents;
}

function centsToDecimalString(value) {
  const cents = BigInt(value);
  const sign = cents < 0n ? '-' : '';
  const absoluteCents = cents < 0n ? -cents : cents;
  return `${sign}${absoluteCents / 100n}.${(absoluteCents % 100n).toString().padStart(2, '0')}`;
}

function percentageToBasisPoints(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new TypeError('Percentual inválido.');
  const [, integerPart, fractionalPart = ''] = match;
  return BigInt(integerPart) * 100n + BigInt(fractionalPart.padEnd(2, '0'));
}

export function maxCurrency(values) {
  if (!values.length) return '0.00';
  return centsToDecimalString(values.reduce((maximum, value) => {
    const cents = moneyToCents(value);
    return cents > maximum ? cents : maximum;
  }, moneyToCents(values[0])));
}

export function calculateCommissionPreview({ saleValue, commissionType, commissionInput }) {
  if (commissionType === 'fixed') return centsToDecimalString(moneyToCents(commissionInput));
  if (commissionType !== 'percentage') throw new TypeError('Tipo de comissão inválido.');

  const cents = moneyToCents(saleValue);
  const basisPoints = percentageToBasisPoints(commissionInput);
  return centsToDecimalString((cents * basisPoints + 5000n) / 10000n);
}

export function sumCurrency(...values) {
  return centsToDecimalString(values.reduce((total, value) => total + moneyToCents(value), 0n));
}

export function formatCurrency(value) {
  const { sign, integerPart, fractionalPart } = moneyParts(value);
  return `${sign ? '-R$' : 'R$'} ${integerFormatter.format(BigInt(integerPart))},${fractionalPart}`;
}

export function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

export function formatPercent(value) {
  if (value === null || value === undefined || value === '') return 'Não definido';
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new TypeError('Percentual inválido.');
  const [, integerPart, fractionalPart] = match;
  return `${integerFormatter.format(BigInt(integerPart))}${fractionalPart ? `,${fractionalPart}` : ''}%`;
}
