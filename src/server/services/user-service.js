import { randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';
import { normalizeIdentifier, validatePassword } from '../domain/validation.js';

const sellerColumns = 'id, email, username, display_name, phone, active';
const legacySellerColumns = 'id, email, username, display_name, active';

function hasMissingSellerPhone(error) {
  const source = [error?.code, error?.message, error?.details].join(' ').toLocaleLowerCase('pt-BR');
  return (error?.code === '42703' || error?.code === 'PGRST204') && /phone/.test(source);
}

function withoutSellerPhone(profile) {
  const { phone: _phone, ...baseProfile } = profile;
  return baseProfile;
}

function sellerAuthMetadata(input) {
  const metadata = {};
  if (input.phone !== null) metadata.galaxy_smart_phone = input.phone;
  return Object.keys(metadata).length ? metadata : null;
}

function validationError(message) {
  return new AppError(message, { status: 400, code: 'INVALID_SELLER' });
}

function conflictError(message, code) {
  return new AppError(message, { status: 409, code });
}

function authRecoveryError(message, code, cause) {
  const error = new AppError(message, { status: 500, code });
  error.cause = cause;
  return error;
}

function translateUniqueConflict(error) {
  const source = [error?.code, error?.message, error?.details].join(' ').toLocaleLowerCase('pt-BR');
  const isUniqueConflict = error?.code === '23505' || /already exists|duplicate|unique|_exists/.test(source);
  if (!isUniqueConflict) return error;
  if (source.includes('username')) {
    return conflictError('Nome de usuário já está em uso.', 'USERNAME_TAKEN');
  }
  if (source.includes('email')) {
    return conflictError('E-mail já está em uso.', 'EMAIL_TAKEN');
  }
  return error;
}

function requireAdmin(actor) {
  if (actor?.role !== 'admin' || actor.active !== true) {
    throw new AppError('Acesso permitido somente à administração.', { status: 403, code: 'ADMIN_REQUIRED' });
  }
}

function requireText(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw validationError(message);
  return text;
}

function privateSellerEmail() {
  return `seller-${randomBytes(16).toString('hex')}@users.galaxy-smart.invalid`;
}

function parseUsername(value) {
  const username = requireText(value, 'Informe um nome de usuário.');
  const usernameNormalized = normalizeIdentifier(username);
  if (!usernameNormalized || usernameNormalized.includes('/')) {
    throw validationError('Informe um nome de usuário válido.');
  }
  return { username, usernameNormalized };
}

function parsePhone(value) {
  const phone = String(value ?? '').trim();
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!/^[+()\s.-\d]+$/.test(phone) || digits.length < 10 || digits.length > 15) {
    throw validationError('Informe um telefone válido.');
  }
  return digits;
}

function assertNoRole(input) {
  if (Object.hasOwn(input, 'role')) {
    throw validationError('O papel da conta é definido pelo servidor.');
  }
}

function assertNoDefaultCommissionRate(input) {
  if (Object.hasOwn(input, 'defaultCommissionRate')) {
    throw validationError('A comissão padrão é definida pela administração em Produtos.');
  }
}

function createInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Dados do vendedor inválidos.');
  }
  assertNoRole(input);
  assertNoDefaultCommissionRate(input);

  let password;
  try {
    password = validatePassword(input.password);
  } catch (error) {
    throw validationError(error.message);
  }

  return {
    name: requireText(input.name, 'Informe o nome do vendedor.'),
    ...parseUsername(input.username),
    password,
    phone: parsePhone(input.phone),
  };
}

function updateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Dados do vendedor inválidos.');
  }
  assertNoRole(input);
  assertNoDefaultCommissionRate(input);

  const update = {};
  if (Object.hasOwn(input, 'name')) update.display_name = requireText(input.name, 'Informe o nome do vendedor.');
  if (Object.hasOwn(input, 'username')) {
    const username = parseUsername(input.username);
    update.username = username.username;
    update.username_normalized = username.usernameNormalized;
  }
  if (Object.hasOwn(input, 'phone')) update.phone = parsePhone(input.phone);
  return update;
}

function sellerView(profile) {
  return {
    id: profile.id,
    name: profile.display_name,
    username: profile.username,
    phone: profile.phone ?? '',
    active: profile.active,
  };
}

function sellerNotFound() {
  return new AppError('Vendedor não encontrado.', { status: 404, code: 'SELLER_NOT_FOUND' });
}

function defaultTemporaryPassword() {
  return randomBytes(24).toString('base64url');
}

export function createUserService({
  adminClient,
  now = () => new Date(),
  createTemporaryPassword = defaultTemporaryPassword,
}) {
  async function updateSellerProfile(id, update) {
    const persist = (columns) => adminClient.from('profiles')
      .update(update)
      .eq('id', id)
      .eq('role', 'seller')
      .select(columns)
      .maybeSingle();
    let result = await persist(sellerColumns);
    if (hasMissingSellerPhone(result.error)) result = await adminClient.from('profiles')
      .update(withoutSellerPhone(update))
      .eq('id', id)
      .eq('role', 'seller')
      .select(legacySellerColumns)
      .maybeSingle();
    return result;
  }

  return {
    async createSeller(input, actor) {
      requireAdmin(actor);
      const sellerInput = createInput(input);
      const authEmail = privateSellerEmail();
      const metadata = sellerAuthMetadata(sellerInput);
      const created = await adminClient.auth.admin.createUser({
        email: authEmail,
        password: sellerInput.password,
        email_confirm: true,
        ...(metadata ? { user_metadata: metadata } : {}),
      });
      if (created.error) throw translateUniqueConflict(created.error);

      const id = created.data?.user?.id;
      if (!id) throw new Error('O Supabase não retornou a identidade do vendedor.');

      const profile = {
        id,
        email: authEmail,
        username: sellerInput.username,
        username_normalized: sellerInput.usernameNormalized,
        display_name: sellerInput.name,
        phone: sellerInput.phone,
        role: 'seller',
        active: true,
      };
      try {
        const insertProfile = async (row, columns) => adminClient.from('profiles')
          .insert(row)
          .select(columns)
          .single();
        let inserted = await insertProfile(profile, sellerColumns);
        let usedLegacyProfile = false;
        if (hasMissingSellerPhone(inserted.error)) {
          inserted = await insertProfile(withoutSellerPhone(profile), legacySellerColumns);
          usedLegacyProfile = true;
        }
        if (inserted.error) throw translateUniqueConflict(inserted.error);
        const savedProfile = inserted.data ?? profile;
        return sellerView(usedLegacyProfile
          ? {
            ...savedProfile,
            phone: sellerInput.phone,
          }
          : savedProfile);
      } catch (error) {
        let compensationFailed = false;
        try {
          const deleted = await adminClient.auth.admin.deleteUser(id);
          compensationFailed = Boolean(deleted?.error);
        } catch {
          compensationFailed = true;
        }
        if (compensationFailed) {
          throw authRecoveryError(
            'Não foi possível compensar a criação do vendedor.',
            'AUTH_COMPENSATION_FAILED',
            error,
          );
        }
        throw error;
      }
    },

    async updateSeller(id, input, actor) {
      requireAdmin(actor);
      const update = updateInput(input);
      const timestamp = now().toISOString();
      const profileUpdate = await updateSellerProfile(id, { ...update, updated_at: timestamp });
      if (profileUpdate.error) throw translateUniqueConflict(profileUpdate.error);
      if (!profileUpdate.data) throw sellerNotFound();
      return sellerView(profileUpdate.data);
    },

    async resetSellerPassword(id, actor) {
      requireAdmin(actor);
      const timestamp = now().toISOString();
      const profileUpdate = await updateSellerProfile(id, { session_not_before: timestamp, updated_at: timestamp });
      if (profileUpdate.error) throw profileUpdate.error;
      if (!profileUpdate.data) throw sellerNotFound();

      const temporaryPassword = createTemporaryPassword();
      const authUpdate = await adminClient.auth.admin.updateUserById(id, { password: temporaryPassword });
      if (authUpdate.error) throw authUpdate.error;
      return { temporaryPassword };
    },

    async deleteSeller(id, actor) {
      requireAdmin(actor);
      const { data, error } = await adminClient.rpc('delete_seller', {
        p_target_id: id,
        p_actor_id: actor.id,
      });
      if (error) {
        if (error.code === 'P0002') throw sellerNotFound();
        if (error.code === '22023') {
          throw new AppError('Não é possível excluir este perfil.', {
            status: 400,
            code: 'SELLER_DELETE_FORBIDDEN',
          });
        }
        throw error;
      }
      const deleted = Array.isArray(data) ? data[0] : data;
      if (!deleted || deleted.deleted_seller_id !== id) throw sellerNotFound();

      const { error: authError } = await adminClient.auth.admin.deleteUser(id);
      if (authError) throw authError;
    },

    async setSellerActive(id, active, actor) {
      requireAdmin(actor);
      const timestamp = now().toISOString();
      const profileUpdate = await updateSellerProfile(id, {
        active,
        session_not_before: timestamp,
        updated_at: timestamp,
      });
      if (profileUpdate.error) throw profileUpdate.error;
      if (!profileUpdate.data) throw sellerNotFound();

      if (!active) {
        const { error: registryError } = await adminClient.from('app_session_registry')
          .update({ revoked_at: timestamp })
          .eq('user_id', id)
          .is('revoked_at', null);
        if (registryError) throw registryError;
      }

      const authUpdate = await adminClient.auth.admin.updateUserById(id, {
        ban_duration: active ? 'none' : '876000h',
      });
      if (authUpdate.error) throw authUpdate.error;
      return sellerView(profileUpdate.data);
    },

    async listSellers(actor, { includeArchived = false } = {}) {
      requireAdmin(actor);
      const list = async (columns) => {
        let query = adminClient.from('profiles')
          .select(columns)
          .eq('role', 'seller');
        if (!includeArchived) query = query.is('archived_at', null);
        return query.order('display_name', { ascending: true });
      };
      let result = await list(sellerColumns);
      if (hasMissingSellerPhone(result.error)) result = await list(legacySellerColumns);
      if (result.error) throw result.error;
      return (result.data ?? []).map(sellerView);
    },
  };
}
