import { randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';
import { normalizeIdentifier, validatePassword } from '../domain/validation.js';

const administratorColumns = 'id, username, display_name, active';

function requireActiveAdministrator(actor) {
  if (actor?.role !== 'admin' || actor.active !== true) {
    throw new AppError('Acesso permitido somente à administração.', { status: 403, code: 'ADMIN_REQUIRED' });
  }
}

function validationError(message) {
  return new AppError(message, { status: 400, code: 'INVALID_ADMINISTRATOR' });
}

function translateUsernameUniqueConflict(error) {
  const source = [error?.code, error?.message, error?.details].join(' ').toLocaleLowerCase('pt-BR');
  const isUniqueConflict = error?.code === '23505' || /already exists|duplicate|unique|_exists/.test(source);
  if (isUniqueConflict && source.includes('username')) {
    return new AppError('Nome de usuário já está em uso.', { status: 409, code: 'USERNAME_TAKEN' });
  }
  return error;
}

function authRecoveryError(cause) {
  const error = new AppError('Não foi possível compensar a criação do administrador.', {
    status: 500,
    code: 'AUTH_COMPENSATION_FAILED',
  });
  error.cause = cause;
  return error;
}

function requireText(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw validationError(message);
  return text;
}

function assertNoBrowserControlledAccountFields(input) {
  for (const field of ['role', 'email', 'phone']) {
    if (Object.hasOwn(input, field)) {
      throw validationError('O papel e os contatos da conta são definidos pelo servidor.');
    }
  }
}

function createInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Dados do administrador inválidos.');
  }
  assertNoBrowserControlledAccountFields(input);

  const username = requireText(input.username, 'Informe um nome de usuário.');
  const usernameNormalized = normalizeIdentifier(username);
  if (!usernameNormalized || usernameNormalized.includes('/')) {
    throw validationError('Informe um nome de usuário válido.');
  }

  let password;
  try {
    password = validatePassword(input.password);
  } catch (error) {
    throw validationError(error.message);
  }

  return {
    name: requireText(input.name, 'Informe o nome do administrador.'),
    username,
    usernameNormalized,
    password,
  };
}

function privateAdministratorEmail() {
  return `admin-${randomBytes(16).toString('hex')}@users.galaxy-smart.invalid`;
}

function archiveAdministratorError(error) {
  if (error?.code === '22023') {
    return new AppError('Você não pode arquivar a própria conta de administrador.', {
      status: 400,
      code: 'SELF_ARCHIVE_FORBIDDEN',
    });
  }
  if (error?.code === '23514') {
    return new AppError('Não é possível arquivar o último administrador ativo.', {
      status: 409,
      code: 'LAST_ADMINISTRATOR',
    });
  }
  if (error?.code === 'P0002') {
    return new AppError('Administrador não encontrado.', { status: 404, code: 'ADMINISTRATOR_NOT_FOUND' });
  }
  return error;
}

function administratorView(profile) {
  return {
    id: profile.id,
    name: profile.display_name,
    username: profile.username,
    active: profile.active,
  };
}

export function createAdministratorService({ adminClient, now = () => new Date() }) {
  return {
    async createAdministrator(input, actor) {
      requireActiveAdministrator(actor);
      const administratorInput = createInput(input);
      const authEmail = privateAdministratorEmail();
      const created = await adminClient.auth.admin.createUser({
        email: authEmail,
        password: administratorInput.password,
        email_confirm: true,
      });
      if (created.error) throw created.error;

      const id = created.data?.user?.id;
      if (!id) throw new Error('O Supabase não retornou a identidade do administrador.');

      const profile = {
        id,
        email: authEmail,
        username: administratorInput.username,
        username_normalized: administratorInput.usernameNormalized,
        display_name: administratorInput.name,
        role: 'admin',
        active: true,
      };
      try {
        const inserted = await adminClient.from('profiles')
          .insert(profile)
          .select(administratorColumns)
          .single();
        if (inserted.error) throw inserted.error;
        return administratorView(inserted.data ?? profile);
      } catch (error) {
        let compensationFailed = false;
        try {
          const deleted = await adminClient.auth.admin.deleteUser(id);
          compensationFailed = Boolean(deleted?.error);
        } catch {
          compensationFailed = true;
        }
        if (compensationFailed) throw authRecoveryError(error);
        throw translateUsernameUniqueConflict(error);
      }
    },

    async archiveAdministrator(id, actor) {
      requireActiveAdministrator(actor);
      const { data, error } = await adminClient.rpc('archive_profile', {
        p_target_id: id,
        p_actor_id: actor.id,
        p_expected_role: 'admin',
      });
      if (error) throw archiveAdministratorError(error);
      const archived = Array.isArray(data) ? data[0] : data;
      if (!archived || archived.target_role !== 'admin') {
        throw new AppError('Administrador não encontrado.', { status: 404, code: 'ADMINISTRATOR_NOT_FOUND' });
      }

      const timestamp = now().toISOString();
      const { error: registryError } = await adminClient.from('app_session_registry')
        .update({ revoked_at: timestamp })
        .eq('user_id', id)
        .is('revoked_at', null);
      if (registryError) throw registryError;
    },

    async listAdministrators(actor) {
      requireActiveAdministrator(actor);
      const result = await adminClient.from('profiles')
        .select(administratorColumns)
        .eq('role', 'admin')
        .is('archived_at', null)
        .order('display_name', { ascending: true });
      if (result.error) throw result.error;
      return (result.data ?? []).map(administratorView);
    },
  };
}
