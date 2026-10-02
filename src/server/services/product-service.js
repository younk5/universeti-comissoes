import { AppError } from '../errors.js';
import {
  serializeProduct,
  validateProductInput,
  validateProductUpdate,
} from '../domain/products.js';

const productColumns = 'id, name, commission_type, commission_rate_bps, commission_fixed_cents, active';

function productError(message, { status = 400, code = 'INVALID_PRODUCT' } = {}) {
  return new AppError(message, { status, code });
}

function requireAdmin(actor) {
  if (actor?.role !== 'admin' || actor.active !== true) {
    throw productError('Acesso permitido somente à administração.', { status: 403, code: 'ADMIN_REQUIRED' });
  }
}

function productId(value) {
  const id = String(value ?? '').trim();
  if (!id) throw productError('Produto não encontrado.', { status: 404, code: 'PRODUCT_NOT_FOUND' });
  return id;
}

function productNotFound() {
  return productError('Produto não encontrado.', { status: 404, code: 'PRODUCT_NOT_FOUND' });
}

function productInactive() {
  return productError('Produto está inativo.', { status: 409, code: 'PRODUCT_INACTIVE' });
}

function translateProductError(error) {
  const source = [error?.code, error?.message, error?.details].join(' ').toLocaleLowerCase('pt-BR');
  if (error?.code === '23505' || /duplicate|unique|already exists/.test(source)) {
    return productError('Já existe um produto com este nome.', { status: 409, code: 'PRODUCT_NAME_TAKEN' });
  }
  return error;
}

function validatedCreate(input) {
  try {
    return validateProductInput(input);
  } catch (error) {
    throw productError(error.message);
  }
}

function valuesToRow(values, { active } = {}) {
  return {
    name: values.name,
    commission_type: values.commissionType,
    commission_rate_bps: values.commissionRateBps,
    commission_fixed_cents: values.commissionFixedCents,
    ...(active === undefined ? {} : { active }),
  };
}

function ruleChanged(current, values) {
  return current.commission_type !== values.commissionType
    || current.commission_rate_bps !== values.commissionRateBps
    || current.commission_fixed_cents !== values.commissionFixedCents;
}

function changed(current, values) {
  return current.name !== values.name || ruleChanged(current, values);
}

function rpcResult(data) {
  return Array.isArray(data) ? data[0] : data;
}

export function createProductService({ adminClient }) {
  async function findProduct(id) {
    const { data, error } = await adminClient.from('products')
      .select(productColumns)
      .eq('id', productId(id))
      .maybeSingle();
    if (error) throw translateProductError(error);
    if (!data) throw productNotFound();
    return data;
  }

  async function directUpdate(id, row, { activeOnly = false } = {}) {
    let query = adminClient.from('products').update(row).eq('id', productId(id));
    if (activeOnly) query = query.eq('active', true);
    const { data, error } = await query.select(productColumns).maybeSingle();
    if (error) throw translateProductError(error);
    if (!data) throw activeOnly ? productInactive() : productNotFound();
    return data;
  }

  return {
    async list({ actor, includeInactive = false }) {
      requireAdmin(actor);
      let query = adminClient.from('products').select(productColumns);
      if (!includeInactive) query = query.eq('active', true);
      const { data, error } = await query.order('name', { ascending: true });
      if (error) throw translateProductError(error);
      return (data ?? []).map(serializeProduct);
    },

    async create({ actor, input }) {
      requireAdmin(actor);
      const values = validatedCreate(input);
      const { data, error } = await adminClient.from('products')
        .insert(valuesToRow(values, { active: true }))
        .select(productColumns)
        .single();
      if (error) throw translateProductError(error);
      if (!data) throw productNotFound();
      return serializeProduct(data);
    },

    async update({ actor, id, input }) {
      requireAdmin(actor);
      const current = await findProduct(id);
      if (current.active !== true) throw productInactive();

      let values;
      try {
        values = validateProductUpdate(input, serializeProduct(current));
      } catch (error) {
        throw productError(error.message);
      }
      if (!changed(current, values)) {
        return { ...serializeProduct(current), recalculatedPendingCount: 0 };
      }

      if (!ruleChanged(current, values)) {
        const updated = await directUpdate(id, { name: values.name }, { activeOnly: true });
        return { ...serializeProduct(updated), recalculatedPendingCount: 0 };
      }

      const { data, error } = await adminClient.rpc('update_product_rule', {
        p_product_id: productId(id),
        p_actor_id: actor.id,
        p_name: values.name,
        p_commission_type: values.commissionType,
        p_commission_rate_bps: values.commissionRateBps,
        p_commission_fixed_cents: values.commissionFixedCents,
      });
      if (error) {
        if (error.code === 'P0002') throw productNotFound();
        if (error.code === 'P0001') throw productInactive();
        throw translateProductError(error);
      }
      const result = rpcResult(data);
      if (!result?.product_id) throw productNotFound();
      const updated = await findProduct(result.product_id);
      return {
        ...serializeProduct(updated),
        recalculatedPendingCount: result.recalculated_pending_count ?? 0,
      };
    },

    async setActive({ actor, id, active }) {
      requireAdmin(actor);
      if (typeof active !== 'boolean') throw productError('Estado do produto inválido.');
      const updated = await directUpdate(id, { active }, { activeOnly: !active });
      return serializeProduct(updated);
    },

    async remove({ actor, id }) {
      requireAdmin(actor);
      const { data, error } = await adminClient.rpc('delete_product', {
        p_product_id: productId(id),
        p_actor_id: actor.id,
      });
      if (error) {
        if (error.code === 'P0002') throw productNotFound();
        if (error.code === '23503') {
          throw productError('Este produto está em uso por comissões e não pode ser excluído.', {
            status: 409,
            code: 'PRODUCT_IN_USE',
          });
        }
        throw translateProductError(error);
      }
      const deleted = rpcResult(data);
      if (!deleted?.deleted_product_id) throw productNotFound();
      return { id: deleted.deleted_product_id };
    },
  };
}
