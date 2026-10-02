import { AppError } from '../errors.js';
import {
  buildMonthlyPaidSeries,
  serializeCommission,
  summarizeCommissions,
} from '../domain/commissions.js';
import {
  normalizeProductId,
  parseMoneyToCents,
  validateCommissionInput,
} from '../domain/validation.js';

const commissionColumns = [
  'id',
  'seller_id',
  'seller_name_snapshot',
  'product_id',
  'product',
  'sale_value_cents',
  'commission_type',
  'commission_rate_bps',
  'commission_fixed_cents',
  'commission_value_cents',
  'sale_date',
  'status',
  'paid_at',
  'note',
  'created_at',
  'updated_at',
].join(', ');

const sellerColumns = 'id, display_name, role, active';
const paymentEventColumns = 'id, commission_id, actor_id, event_type, previous_status, new_status, created_at';
const publicActorColumns = 'id, display_name';
const editableCommissionFields = new Set([
  'sellerId', 'productId', 'product', 'saleValue', 'saleDate', 'note',
]);

function invalidCommission(message) {
  return new AppError(message, { status: 400, code: 'INVALID_COMMISSION' });
}

function forbidden() {
  return new AppError('Acesso permitido somente à administração.', { status: 403, code: 'ADMIN_REQUIRED' });
}

function sellerNotFound() {
  return new AppError('Vendedor não encontrado.', { status: 404, code: 'SELLER_NOT_FOUND' });
}

function commissionNotFound() {
  return new AppError('Comissão não encontrada.', { status: 404, code: 'COMMISSION_NOT_FOUND' });
}

function productNotFound() {
  return new AppError('Produto não encontrado.', { status: 404, code: 'PRODUCT_NOT_FOUND' });
}

function requireActor(actor) {
  if (!actor || actor.active !== true || !['admin', 'seller'].includes(actor.role)) throw forbidden();
}

function requireAdmin(actor) {
  requireActor(actor);
  if (actor.role !== 'admin') throw forbidden();
}

function validCommissionId(value) {
  const id = String(value ?? '').trim();
  if (!id) throw commissionNotFound();
  return id;
}

function validCommissionIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0
    || ids.some((id) => typeof id !== 'string' || !id.trim())) {
    throw invalidCommission('Informe as comissões a marcar como pagas.');
  }
  return [...new Set(ids.map((id) => id.trim()))];
}

function editableCommissionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length === 0
    || Object.keys(input).some((field) => !editableCommissionFields.has(field))) {
    throw invalidCommission('Dados da comissão inválidos.');
  }
  return input;
}

function optionalFilterText(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw invalidCommission(`Filtro ${field} inválido.`);
  return value.trim();
}

function validFilter(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidCommission('Filtros de comissão inválidos.');
  }

  const filter = {
    sellerId: optionalFilterText(input.sellerId, 'de vendedor'),
    startDate: optionalFilterText(input.startDate, 'de data inicial'),
    endDate: optionalFilterText(input.endDate, 'de data final'),
    paymentStatus: optionalFilterText(input.paymentStatus ?? input.status, 'de status'),
  };
  for (const [name, date] of [['inicial', filter.startDate], ['final', filter.endDate]]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date)) {
      throw invalidCommission(`Filtro de data ${name} inválido.`);
    }
  }
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) {
    throw invalidCommission('A data inicial não pode ser posterior à data final.');
  }
  if (filter.paymentStatus && !['pending', 'paid', 'voided'].includes(filter.paymentStatus)) {
    throw invalidCommission('Filtro de status inválido.');
  }
  return filter;
}

function validCommissionInput(input) {
  let validated;
  try {
    validated = validateCommissionInput(input);
  } catch (error) {
    throw invalidCommission(error.message);
  }

  try {
    return {
      sellerId: validated.sellerId,
      productId: validated.productId,
      product: validated.product,
      saleValueCents: parseMoneyToCents(input.saleValue),
      saleDate: validated.saleDate,
      note: validated.note,
    };
  } catch (error) {
    throw invalidCommission(error.message);
  }
}

function validProductId(value) {
  try {
    return normalizeProductId(value);
  } catch (error) {
    throw invalidCommission(error.message);
  }
}

function rpcRows(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

async function sellerFor(adminClient, sellerId) {
  const { data, error } = await adminClient.from('profiles')
    .select(sellerColumns)
    .eq('id', sellerId)
    .eq('role', 'seller')
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data?.display_name || data.role !== 'seller' || data.active !== true) throw sellerNotFound();
  return data;
}

async function productBackedCommission(adminClient, { commissionId = null, actor, values, seller }) {
  const { data, error } = await adminClient.rpc('upsert_product_backed_commission', {
    p_commission_id: commissionId,
    p_actor_id: actor.id,
    p_seller_id: values.sellerId,
    p_seller_name_snapshot: seller.display_name,
    p_product_id: values.productId,
    p_sale_value_cents: values.saleValueCents,
    p_sale_date: values.saleDate,
    p_note: values.note,
  });
  if (error) {
    if (['P0001', 'P0002'].includes(error.code)) throw productNotFound();
    throw error;
  }
  return rpcRows(data)[0] ?? null;
}

async function defaultBackedCommission(adminClient, { commissionId = null, actor, values, seller }) {
  const { data, error } = await adminClient.rpc('upsert_default_backed_commission', {
    p_commission_id: commissionId,
    p_actor_id: actor.id,
    p_seller_id: values.sellerId,
    p_seller_name_snapshot: seller.display_name,
    p_product: values.product,
    p_sale_value_cents: values.saleValueCents,
    p_sale_date: values.saleDate,
    p_note: values.note,
  });
  if (error) {
    if (error.code === 'P0001') {
      throw new AppError('A regra de comissão padrão não está configurada. Configure-a em Produtos.', {
        status: 409,
        code: 'DEFAULT_COMMISSION_RULE_UNCONFIGURED',
      });
    }
    throw error;
  }
  return rpcRows(data)[0] ?? null;
}

async function currentCommissionFor(adminClient, id) {
  const { data, error } = await adminClient.from('commissions')
    .select(commissionColumns)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw commissionNotFound();
  return data;
}

export function createCommissionService({ adminClient, now = () => new Date() }) {
  void now;

  async function listCommissions({ actor, filters, includeArchived = false }) {
    requireActor(actor);
    const filter = validFilter(filters);
    const sellerId = actor.role === 'seller' ? actor.id : filter.sellerId;
    if (actor.role === 'seller' && !sellerId) throw invalidCommission('Vendedor sem perfil.');

    let query = adminClient.from('commissions').select(commissionColumns);
    if (sellerId) query = query.eq('seller_id', sellerId);
    if (filter.startDate) query = query.gte('sale_date', filter.startDate);
    if (filter.endDate) query = query.lte('sale_date', filter.endDate);
    if (filter.paymentStatus) query = query.eq('status', filter.paymentStatus);
    if (!includeArchived && !filter.paymentStatus) query = query.neq('status', 'voided');
    const { data, error } = await query
      .order('sale_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;

    const items = (data ?? []).map(serializeCommission);
    return { items, ...summarizeCommissions(items) };
  }

  async function listAuditEvents({ actor, filters }) {
    requireAdmin(actor);
    const filter = validFilter(filters);
    const { items: commissions } = await listCommissions({
      actor,
      filters: filter,
      includeArchived: true,
    });
    const commissionsById = new Map(commissions.map((item) => [item.id, item]));

    let paymentRows = [];
    if (commissionsById.size) {
      const { data, error } = await adminClient.from('commission_payment_events')
        .select(paymentEventColumns)
        .in('commission_id', [...commissionsById.keys()])
        .order('created_at', { ascending: false });
      if (error) throw error;
      paymentRows = data ?? [];
    }

    let archiveQuery = adminClient.from('profile_archive_events')
      .select('id, actor_id, target_id, target_role, target_display_name, archived_at');
    if (filter.sellerId) archiveQuery = archiveQuery.eq('target_id', filter.sellerId);
    if (filter.startDate) archiveQuery = archiveQuery.gte('archived_at', `${filter.startDate}T00:00:00.000Z`);
    if (filter.endDate) archiveQuery = archiveQuery.lte('archived_at', `${filter.endDate}T23:59:59.999Z`);
    const { data: archiveRows, error: archiveError } = await archiveQuery
      .order('archived_at', { ascending: false });
    if (archiveError) throw archiveError;

    const actorIds = [...new Set([
      ...paymentRows.map((row) => row.actor_id),
      ...(archiveRows ?? []).map((row) => row.actor_id),
    ].filter(Boolean))];
    const actorNames = new Map();
    if (actorIds.length) {
      const { data: profiles, error: profileError } = await adminClient.from('profiles')
        .select(publicActorColumns)
        .in('id', actorIds);
      if (profileError) throw profileError;
      for (const profile of profiles ?? []) {
        if (profile?.id && profile.display_name) actorNames.set(profile.id, profile.display_name);
      }
    }

    const paymentEvents = paymentRows.flatMap((row) => {
      const commission = commissionsById.get(row.commission_id);
      if (!commission) return [];
      return [{
        id: row.id,
        eventType: row.event_type,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        occurredAt: row.created_at,
        commissionId: commission.id,
        sellerId: commission.sellerId,
        sellerName: commission.sellerName,
        product: commission.product,
        saleDate: commission.saleDate,
        commissionValue: commission.commissionValue,
        actorName: actorNames.get(row.actor_id) ?? 'Não informado',
      }];
    });
    const profileArchiveEvents = (archiveRows ?? []).map((row) => ({
      id: row.id,
      eventType: 'archived',
      occurredAt: row.archived_at,
      targetType: row.target_role,
      targetId: row.target_id,
      targetName: row.target_display_name,
      actorName: actorNames.get(row.actor_id) ?? 'Não informado',
    }));

    return {
      items: [...paymentEvents, ...profileArchiveEvents].sort((left, right) => (
        String(right.occurredAt).localeCompare(String(left.occurredAt)) || String(right.id).localeCompare(String(left.id))
      )),
    };
  }

  return {
    async create({ actor, input }) {
      requireAdmin(actor);
      const values = validCommissionInput(editableCommissionInput(input));
      const seller = await sellerFor(adminClient, values.sellerId);
      if (values.productId) {
        const data = await productBackedCommission(adminClient, { actor, values, seller });
        if (!data) throw productNotFound();
        return serializeCommission(data);
      }
      const data = await defaultBackedCommission(adminClient, { actor, values, seller });
      if (!data) throw commissionNotFound();
      return serializeCommission(data);
    },

    async update({ actor, id, input }) {
      requireAdmin(actor);
      const commissionId = validCommissionId(id);
      const changes = editableCommissionInput(input);
      const productId = Object.hasOwn(changes, 'productId')
        ? validProductId(changes.productId)
        : undefined;
      const current = await currentCommissionFor(adminClient, commissionId);
      const values = validCommissionInput({
        ...serializeCommission(current),
        productId: current.product_id,
        ...changes,
        ...(productId === undefined ? {} : { productId }),
      });
      const seller = await sellerFor(adminClient, values.sellerId);
      if (values.productId) {
        const data = await productBackedCommission(adminClient, {
          commissionId,
          actor,
          values,
          seller,
        });
        if (!data) throw commissionNotFound();
        return serializeCommission(data);
      }
      const data = await defaultBackedCommission(adminClient, {
        commissionId,
        actor,
        values,
        seller,
      });
      if (!data) throw commissionNotFound();
      return serializeCommission(data);
    },

    listCommissions,

    listAuditEvents,

    async markPaid({ actor, commissionIds }) {
      requireAdmin(actor);
      const ids = validCommissionIds(commissionIds);
      const { data, error } = await adminClient.rpc('mark_commissions_paid', {
        p_commission_ids: ids,
        p_actor_id: actor.id,
      });
      if (error) throw error;
      const paidIds = rpcRows(data).map((row) => row.commission_id).filter(Boolean);
      return { paidIds, updatedCount: paidIds.length };
    },

    async voidCommission({ actor, id }) {
      requireAdmin(actor);
      const commissionId = validCommissionId(id);
      const { data, error } = await adminClient.rpc('void_commission', {
        p_commission_id: commissionId,
        p_actor_id: actor.id,
      });
      if (error) throw error;
      const voidedId = rpcRows(data)[0]?.commission_id;
      if (!voidedId) throw commissionNotFound();
      return { voidedId };
    },

    async deleteCommission({ actor, id }) {
      requireAdmin(actor);
      const commissionId = validCommissionId(id);
      const { data, error } = await adminClient.rpc('delete_commission', {
        p_commission_id: commissionId,
        p_actor_id: actor.id,
      });
      if (error) {
        if (error.code === 'P0002') throw commissionNotFound();
        throw error;
      }
      const deletedId = rpcRows(data)[0]?.deleted_commission_id;
      if (!deletedId) throw commissionNotFound();
      return { deletedId };
    },

    async wallet({ actor, filters }) {
      const { items, ...totals } = await listCommissions({ actor, filters });
      return {
        ...totals,
        commissions: items,
        monthlyPaid: buildMonthlyPaidSeries(items),
      };
    },
  };
}
