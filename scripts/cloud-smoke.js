import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readConfig } from '../src/server/config.js';
import { createServerServices } from '../src/server/supabase-admin.js';
import { createCommissionService } from '../src/server/services/commission-service.js';

const fixturePrefix = 'qa-';

function smokeError(message) {
  return new Error(message);
}

function requireSuccessful(result, message) {
  if (result?.error) throw smokeError(message);
  return result?.data;
}

function fixturePassword() {
  return randomBytes(32).toString('base64url');
}

function fixtureText(kind) {
  return `${fixturePrefix}${kind}-${randomUUID()}`;
}

function fixtureIds(fixtures, key) {
  return [...fixtures[key]];
}

async function countRows(adminClient, table) {
  const result = await adminClient.from(table).select('id', { count: 'exact', head: true });
  if (result?.error || !Number.isInteger(result?.count)) {
    throw smokeError(`Não foi possível confirmar a tabela ${table}.`);
  }
  return result.count;
}

export function readCloudSmokeConfig(env) {
  if (env.ALLOW_CLOUD_SMOKE !== '1') {
    throw smokeError('Cloud smoke requer ALLOW_CLOUD_SMOKE=1.');
  }
  return readConfig({ ...env, NODE_ENV: 'production' });
}

export async function assertCloudSmokeDatabaseIsEmpty(adminClient) {
  for (const table of ['profiles', 'commissions']) {
    const count = await countRows(adminClient, table);
    if (count !== 0) throw smokeError(`O banco precisa estar vazio antes do smoke: ${table}.`);
  }
}

async function createAuthFixture(adminClient, { email, password }) {
  const data = requireSuccessful(
    await adminClient.auth.admin.createUser({ email, password, email_confirm: true }),
    'Não foi possível criar a identidade de smoke.',
  );
  if (!data?.user?.id) throw smokeError('O Supabase não retornou a identidade de smoke.');
  return data.user.id;
}

async function createProfileFixture(adminClient, profile) {
  const data = requireSuccessful(
    await adminClient.from('profiles').insert(profile).select('id').single(),
    'Não foi possível criar o perfil de smoke.',
  );
  if (!data?.id) throw smokeError('O Supabase não retornou o perfil de smoke.');
  return data.id;
}

async function createCommissionFixtures(adminClient, sellerId, sellerName) {
  const date = '2026-09-08';
  const data = requireSuccessful(
    await adminClient.from('commissions').insert([
      {
        seller_id: sellerId,
        seller_name_snapshot: sellerName,
        product: fixtureText('commission-a'),
        sale_value_cents: 10000,
        commission_type: 'percentage',
        commission_rate_bps: 1000,
        commission_fixed_cents: null,
        sale_date: date,
        note: fixtureText('note-a'),
      },
      {
        seller_id: sellerId,
        seller_name_snapshot: sellerName,
        product: fixtureText('commission-b'),
        sale_value_cents: 20000,
        commission_type: 'fixed',
        commission_rate_bps: null,
        commission_fixed_cents: 2500,
        sale_date: date,
        note: fixtureText('note-b'),
      },
    ]).select('id'),
    'Não foi possível criar as comissões de smoke.',
  );
  if (!Array.isArray(data) || data.length !== 2 || data.some((commission) => !commission?.id)) {
    throw smokeError('O Supabase não retornou as duas comissões de smoke.');
  }
  return data.map((commission) => commission.id);
}

async function verifySellerIsolation(adminClient, sellerId) {
  const commissions = createCommissionService({ adminClient });
  const wallet = await commissions.wallet({
    actor: { id: sellerId, role: 'seller', active: true },
    filters: { sellerId: 'not-the-seller' },
  });
  if (wallet.commissions.length !== 2 || wallet.commissions.some((commission) => commission.sellerId !== sellerId)) {
    throw smokeError('A leitura de smoke do seller não permaneceu isolada.');
  }
}

async function markCommissionPaid(adminClient, commissionId, actorId) {
  const data = requireSuccessful(
    await adminClient.rpc('mark_commissions_paid', {
      p_commission_ids: [commissionId],
      p_actor_id: actorId,
    }),
    'Não foi possível marcar a comissão de smoke como paga.',
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.commission_id !== commissionId || !row.payment_batch_id) {
    throw smokeError('O pagamento de smoke não retornou a comissão e o lote esperados.');
  }
  return row.payment_batch_id;
}

async function verifyPaymentEvent(adminClient, commissionId) {
  const data = requireSuccessful(
    await adminClient.from('commission_payment_events')
      .select('commission_id, event_type, payment_batch_id')
      .eq('commission_id', commissionId)
      .eq('event_type', 'paid'),
    'Não foi possível confirmar o evento de pagamento de smoke.',
  );
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.commission_id !== commissionId || data[0]?.event_type !== 'paid') {
    throw smokeError('O evento de pagamento de smoke não foi confirmado.');
  }
  return data[0].payment_batch_id;
}

async function deleteRows(adminClient, table, column, ids, message) {
  if (!ids.length) return [];
  const data = requireSuccessful(
    await adminClient.from(table).delete().in(column, ids).select(),
    message,
  );
  return Array.isArray(data) ? data : [];
}

async function cleanupFixtures(adminClient, fixtures) {
  const errors = [];
  const batches = new Set(fixtureIds(fixtures, 'paymentBatchIds'));
  const commissions = fixtureIds(fixtures, 'commissionIds');
  const profiles = fixtureIds(fixtures, 'profileIds');
  const users = fixtureIds(fixtures, 'authUserIds');

  try {
    const events = await deleteRows(
      adminClient,
      'commission_payment_events',
      'commission_id',
      commissions,
      'Não foi possível remover os eventos de smoke.',
    );
    for (const event of events) if (event?.payment_batch_id) batches.add(event.payment_batch_id);
  } catch (error) {
    errors.push(error);
  }
  try {
    await deleteRows(adminClient, 'payment_batches', 'id', [...batches], 'Não foi possível remover os lotes de smoke.');
  } catch (error) {
    errors.push(error);
  }
  try {
    await deleteRows(adminClient, 'commissions', 'id', commissions, 'Não foi possível remover as comissões de smoke.');
  } catch (error) {
    errors.push(error);
  }
  try {
    await deleteRows(adminClient, 'profiles', 'id', profiles, 'Não foi possível remover os perfis de smoke.');
  } catch (error) {
    errors.push(error);
  }
  for (const id of users) {
    try {
      requireSuccessful(await adminClient.auth.admin.deleteUser(id), 'Não foi possível remover a identidade de smoke.');
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function isExplicitAuthNotFound(error) {
  if (!error || typeof error !== 'object') return false;
  return error.status === 404
    || error.statusCode === 404
    || error.code === 404
    || error.code === 'user_not_found';
}

export async function survivingFixtures(adminClient, fixtures) {
  const survivors = [];
  for (const [table, ids] of [
    ['commission_payment_events', fixtureIds(fixtures, 'commissionIds')],
    ['payment_batches', fixtureIds(fixtures, 'paymentBatchIds')],
    ['commissions', fixtureIds(fixtures, 'commissionIds')],
    ['profiles', fixtureIds(fixtures, 'profileIds')],
  ]) {
    if (!ids.length) continue;
    const result = await adminClient.from(table).select('id', { count: 'exact', head: true }).in(
      table === 'commission_payment_events' ? 'commission_id' : 'id',
      ids,
    );
    if (result?.error || !Number.isInteger(result?.count)) {
      survivors.push(`não foi possível confirmar ${table}`);
    } else if (result.count !== 0) {
      survivors.push(table);
    }
  }
  for (const id of fixtureIds(fixtures, 'authUserIds')) {
    try {
      const result = await adminClient.auth.admin.getUserById(id);
      if (result?.data?.user) {
        survivors.push('auth.users');
      } else if (result?.error && !isExplicitAuthNotFound(result.error)) {
        survivors.push('não foi possível confirmar auth.users');
      } else if (!result?.error && result?.data?.user !== null) {
        survivors.push('não foi possível confirmar auth.users');
      }
    } catch {
      survivors.push('não foi possível confirmar auth.users');
    }
  }
  return survivors;
}

export async function runCloudSmoke({
  env = process.env,
  createServices = createServerServices,
} = {}) {
  const config = readCloudSmokeConfig(env);
  const { adminClient } = createServices(config);
  if (!adminClient) throw smokeError('Cliente administrativo Supabase ausente.');
  await assertCloudSmokeDatabaseIsEmpty(adminClient);

  const fixtures = {
    authUserIds: new Set(),
    profileIds: new Set(),
    commissionIds: new Set(),
    paymentBatchIds: new Set(),
  };

  try {
    const adminName = fixtureText('admin');
    const sellerName = fixtureText('seller');
    const adminEmail = `${fixtureText('admin')}@example.invalid`;
    const sellerEmail = `${fixtureText('seller')}@example.invalid`;
    const adminUsername = fixtureText('admin-user');
    const sellerUsername = fixtureText('seller-user');
    const adminId = await createAuthFixture(adminClient, {
      email: adminEmail,
      password: fixturePassword(),
    });
    fixtures.authUserIds.add(adminId);
    const sellerId = await createAuthFixture(adminClient, {
      email: sellerEmail,
      password: fixturePassword(),
    });
    fixtures.authUserIds.add(sellerId);

    fixtures.profileIds.add(await createProfileFixture(adminClient, {
      id: adminId,
      email: adminEmail,
      username: adminUsername,
      username_normalized: adminUsername.toLocaleLowerCase('pt-BR'),
      display_name: adminName,
      role: 'admin',
      active: true,
    }));
    fixtures.profileIds.add(await createProfileFixture(adminClient, {
      id: sellerId,
      email: sellerEmail,
      username: sellerUsername,
      username_normalized: sellerUsername.toLocaleLowerCase('pt-BR'),
      display_name: sellerName,
      role: 'seller',
      active: true,
    }));

    for (const id of await createCommissionFixtures(adminClient, sellerId, sellerName)) fixtures.commissionIds.add(id);
    await verifySellerIsolation(adminClient, sellerId);
    const [firstCommissionId] = fixtureIds(fixtures, 'commissionIds');
    fixtures.paymentBatchIds.add(await markCommissionPaid(adminClient, firstCommissionId, adminId));
    fixtures.paymentBatchIds.add(await verifyPaymentEvent(adminClient, firstCommissionId));
  } finally {
    const cleanupErrors = await cleanupFixtures(adminClient, fixtures);
    const survivors = await survivingFixtures(adminClient, fixtures);
    if (cleanupErrors.length || survivors.length) {
      throw smokeError(`A limpeza do cloud smoke falhou: ${survivors.join(', ') || 'erro de remoção'}.`);
    }
  }
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    await runCloudSmoke();
    console.log('Cloud smoke concluído; fixtures qa- removidas.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Cloud smoke falhou.');
    process.exitCode = 1;
  }
}
