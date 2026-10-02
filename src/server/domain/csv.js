const header = ['Vendedor', 'Produto', 'Valor da venda', 'Comissão', 'Data', 'Status', 'Observação'];
const commissionFields = [
  'sellerName',
  'product',
  'saleValue',
  'commissionValue',
  'saleDate',
  'paymentStatus',
  'note',
];

function escapeCsvCell(value) {
  const text = String(value ?? '');
  const neutralized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

function commissionRow(row) {
  if (Array.isArray(row)) return row;
  return commissionFields.map((field) => row[field]);
}

export function buildCsv(rows) {
  const lines = [header, ...rows.map(commissionRow)]
    .map((row) => row.map(escapeCsvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
