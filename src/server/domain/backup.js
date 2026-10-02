import { summarizeCommissions } from './commissions.js';
import { buildXlsx } from './xlsx.js';

const statusLabels = { pending: 'Pendente', paid: 'Pago', voided: 'Anulada' };
const eventLabels = { paid: 'Pagamento', voided: 'Anulação', archived: 'Arquivamento' };
const targetLabels = { admin: 'administrador', seller: 'vendedor' };

function toCents(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '0'));
  if (!match) return 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const reais = BigInt(match[2]);
  const cents = BigInt((match[3] ?? '').padEnd(2, '0'));
  return sign * (reais * 100n + cents);
}

function centsToNumber(cents) {
  return Number(cents) / 100;
}

function centsToDecimal(cents) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function formatCurrency(value) {
  const cents = toCents(value);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const reais = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rest = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${reais},${rest}`;
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? '');
}

function formatDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : String(value ?? '');
}

function statusLabel(status) {
  return statusLabels[status] ?? status ?? '';
}

export function buildBackupWorkbook({
  generatedAt = new Date().toISOString(),
  sellers = [],
  commissions = [],
  auditEvents = [],
} = {}) {
  const totals = summarizeCommissions(commissions);
  const totalCents = toCents(totals.pendingTotal) + toCents(totals.paidTotal);

  const summarySheet = {
    name: 'Resumo',
    title: 'Cópia administrativa — Controle de Comissões',
    columns: [
      { title: 'Indicador', width: 30 },
      { title: 'Valor', width: 26 },
    ],
    rows: [
      ['Gerado em', formatDateTime(generatedAt)],
      ['Vendedores', String(sellers.length)],
      ['Comissões', String(commissions.length)],
      ['A pagar', formatCurrency(totals.pendingTotal)],
      ['Pago', formatCurrency(totals.paidTotal)],
      ['Total de comissões', formatCurrency(centsToDecimal(totalCents))],
    ],
  };

  const sellersSheet = {
    name: 'Vendedores',
    title: `Vendedores (${sellers.length})`,
    columns: [
      { title: 'Nome', width: 26 },
      { title: 'Usuário', width: 20 },
      { title: 'Telefone', width: 18 },
      { title: 'Situação', width: 14 },
    ],
    rows: sellers.map((seller) => [
      seller.name,
      seller.username,
      seller.phone || '—',
      seller.active ? 'Ativo' : 'Desativado',
    ]),
  };

  const commissionsSheet = {
    name: 'Comissões',
    title: `Comissões (${commissions.length})`,
    columns: [
      { title: 'Vendedor', width: 24 },
      { title: 'Produto', width: 28 },
      { title: 'Valor da venda', width: 18, type: 'currency' },
      { title: 'Comissão', width: 16, type: 'currency' },
      { title: 'Data da venda', width: 14 },
      { title: 'Situação', width: 13 },
      { title: 'Observação', width: 32 },
      { title: 'Registrada em', width: 18 },
    ],
    rows: commissions.map((commission) => [
      commission.sellerName,
      commission.product,
      centsToNumber(toCents(commission.saleValue)),
      centsToNumber(toCents(commission.commissionValue)),
      formatDate(commission.saleDate),
      statusLabel(commission.paymentStatus),
      commission.note ?? '',
      formatDateTime(commission.createdAt),
    ]),
  };

  const historySheet = {
    name: 'Histórico',
    title: `Histórico financeiro (${auditEvents.length})`,
    columns: [
      { title: 'Evento', width: 20 },
      { title: 'Vendedor', width: 24 },
      { title: 'Produto', width: 28 },
      { title: 'Comissão', width: 16, type: 'currency' },
      { title: 'Responsável', width: 20 },
      { title: 'Data e hora', width: 18 },
    ],
    rows: auditEvents.map((event) => {
      const archived = event.eventType === 'archived';
      return [
        eventLabels[event.eventType] ?? event.eventType,
        event.sellerName ?? event.targetName ?? 'Não informado',
        event.product ?? (archived ? `Perfil de ${targetLabels[event.targetType] ?? 'perfil'}` : 'Não informado'),
        archived ? '' : centsToNumber(toCents(event.commissionValue ?? '0.00')),
        event.actorName ?? 'Não informado',
        formatDateTime(event.occurredAt),
      ];
    }),
  };

  return buildXlsx({ sheets: [summarySheet, sellersSheet, commissionsSheet, historySheet] });
}