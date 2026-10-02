import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { normalizeIdentifier, validatePassword } from '../src/server/domain/validation.js';
import { readConfig } from '../src/server/config.js';
import { createServerServices } from '../src/server/supabase-admin.js';

const requiredVariables = [
  'BOOTSTRAP_ADMIN_NAME',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_USERNAME',
  'BOOTSTRAP_ADMIN_PASSWORD',
];

const bootstrapScope = 'first-admin';
export const FIRST_ADMIN_LEASE_DURATION_MS = 10 * 60 * 1000;

function requireText(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

function parseEmail(value) {
  const email = normalizeIdentifier(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Informe um e-mail válido.');
  }
  return email;
}

function parseUsername(value) {
  const username = requireText(value, 'Informe um nome de usuário válido.');
  const usernameNormalized = normalizeIdentifier(username);
  if (!usernameNormalized || usernameNormalized.includes('/')) {
    throw new Error('Informe um nome de usuário válido.');
  }
  return { username, usernameNormalized };
}

function secondAdminError() {
  return new Error('Já existe um administrador. O bootstrap não pode continuar.');
}

function leaseInProgressError() {
  return new Error('O bootstrap do primeiro administrador já está em andamento.');
}

function authCompensationError(cause) {
  return new Error('Não foi possível compensar a criação do administrador.', { cause });
}

function isUniqueConflict(error) {
  return error?.code === '23505' || /duplicate|unique|already exists/i.test([
    error?.message,
    error?.details,
  ].join(' '));
}

export function readBootstrapInput(env) {
  const missing = requiredVariables.filter((name) => !String(env[name] ?? '').trim());
  if (missing.length) {
    throw new Error(`Variáveis ausentes: ${missing.join(', ')}`);
  }

  let password;
  try {
    password = validatePassword(env.BOOTSTRAP_ADMIN_PASSWORD);
  } catch (error) {
    throw new Error(error.message);
  }

  return {
    name: requireText(env.BOOTSTRAP_ADMIN_NAME, 'Informe o nome do administrador.'),
    email: parseEmail(env.BOOTSTRAP_ADMIN_EMAIL),
    ...parseUsername(env.BOOTSTRAP_ADMIN_USERNAME),
    password,
  };
}

export async function bootstrapAdmin({
  env = process.env,
  readConfiguration = readConfig,
  createServices = createServerServices,
  now = () => new Date(),
  leaseDurationMs = FIRST_ADMIN_LEASE_DURATION_MS,
  createLeaseOwnerToken = randomUUID,
} = {}) {
  const input = readBootstrapInput(env);
  const { adminClient } = createServices(readConfiguration(env));

  const existing = await adminClient.from('profiles').select('id').eq('role', 'admin').limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length > 0) throw secondAdminError();

  const ownerToken = createLeaseOwnerToken();
  const acquiredAt = now();
  const leaseExpiresAt = new Date(acquiredAt.getTime() + leaseDurationMs).toISOString();
  const expiredLeaseDeletion = await adminClient.from('bootstrap_locks')
    .delete()
    .eq('scope', bootstrapScope)
    .lte('lease_expires_at', acquiredAt.toISOString());
  if (expiredLeaseDeletion.error) throw expiredLeaseDeletion.error;

  const acquiredLease = await adminClient.from('bootstrap_locks').insert({
    scope: bootstrapScope,
    owner_token: ownerToken,
    lease_expires_at: leaseExpiresAt,
  });
  if (acquiredLease.error) {
    if (isUniqueConflict(acquiredLease.error)) throw leaseInProgressError();
    throw acquiredLease.error;
  }

  const releaseLease = async () => {
    const released = await adminClient.from('bootstrap_locks')
      .delete()
      .eq('scope', bootstrapScope)
      .eq('owner_token', ownerToken);
    if (released.error) throw released.error;
  };

  let id;
  try {
    const created = await adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    id = created.data?.user?.id;
    if (!id) throw new Error('O Supabase não retornou a identidade do administrador.');
  } catch (error) {
    try {
      await releaseLease();
    } catch {
      // Preserve the Auth failure without masking it with lock cleanup noise.
    }
    throw error;
  }

  try {
    const inserted = await adminClient.from('profiles').insert({
      id,
      email: input.email,
      username: input.username,
      username_normalized: input.usernameNormalized,
      display_name: input.name,
      role: 'admin',
      active: true,
    });
    if (inserted.error) {
      if (isUniqueConflict(inserted.error)) throw secondAdminError();
      throw inserted.error;
    }
  } catch (error) {
    let deleted;
    try {
      deleted = await adminClient.auth.admin.deleteUser(id);
    } catch {
      // Preserve the profile failure without exposing credentials or cleanup details.
    }
    try {
      await releaseLease();
    } catch {
      // Preserve the profile failure without masking it with lock cleanup noise.
    }
    if (deleted?.error) throw authCompensationError(error);
    throw error;
  }

  await releaseLease();
  return { id, role: 'admin', name: input.name, active: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bootstrapAdmin()
    .then(() => console.log('Primeiro administrador criado.'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
