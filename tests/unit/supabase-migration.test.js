import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/202609080001_secure_galaxy_smart.sql';
const repairMigrationPath = 'supabase/migrations/202609080002_fix_mark_commissions_paid_output_ambiguity.sql';
const sessionRegistryMigrationPath = 'supabase/migrations/202609080003_add_app_session_registry.sql';
const voidCommissionMigrationPath = 'supabase/migrations/202609080004_add_void_commission_rpc.sql';
const serverDmlMigrationPath = 'supabase/migrations/202609080005_grant_server_dml_privileges.sql';
const sellerFieldsMigrationPath = 'supabase/migrations/202609080006_add_seller_contact_and_default_rate.sql';
const multipleAdministratorsMigrationPath = 'supabase/migrations/202609090001_allow_multiple_administrators.sql';
const archivalAuditMigrationPath = 'supabase/migrations/202609090002_add_archival_audit_log.sql';
const archivalExpectedRoleMigrationPath = 'supabase/migrations/202609090003_guard_archive_profile_expected_role.sql';
const postgrestSchemaReloadMigrationPath = 'supabase/migrations/202609090004_reload_postgrest_schema_after_archive_rpc.sql';
const archivalAmbiguityRepairMigrationPath = 'supabase/migrations/202609090005_fix_archive_profile_ambiguous_archived_at.sql';
const productCatalogMigrationPath = 'supabase/migrations/202609150001_add_product_catalog.sql';
const atomicProductCommissionMigrationPath = 'supabase/migrations/202609150002_add_atomic_product_commission_rpc.sql';
const defaultCommissionRuleMigrationPath = 'supabase/migrations/202609160001_add_default_commission_rule.sql';
const hardDeleteMigrationPath = 'supabase/migrations/202609170001_add_hard_delete_rpcs.sql';
const maxMonetaryCents = 900_000_000_000_000n;
const maxBasisPoints = 10_000n;
const maxSignedBigint = 9_223_372_036_854_775_807n;

// Static guardrails only; these tests intentionally do not execute PostgreSQL.
async function readMigration() {
  return readFile(migrationPath, 'utf8');
}

async function readRepairMigration() {
  return readFile(repairMigrationPath, 'utf8');
}

async function readSessionRegistryMigration() {
  return readFile(sessionRegistryMigrationPath, 'utf8');
}

async function readVoidCommissionMigration() {
  return readFile(voidCommissionMigrationPath, 'utf8');
}

async function readServerDmlMigration() {
  return readFile(serverDmlMigrationPath, 'utf8');
}

async function readSellerFieldsMigration() {
  return readFile(sellerFieldsMigrationPath, 'utf8');
}

async function readMultipleAdministratorsMigration() {
  return readFile(multipleAdministratorsMigrationPath, 'utf8');
}

async function readArchivalAuditMigration() {
  return readFile(archivalAuditMigrationPath, 'utf8');
}

async function readArchivalExpectedRoleMigration() {
  return readFile(archivalExpectedRoleMigrationPath, 'utf8');
}

async function readPostgrestSchemaReloadMigration() {
  return readFile(postgrestSchemaReloadMigrationPath, 'utf8');
}

async function readArchivalAmbiguityRepairMigration() {
  return readFile(archivalAmbiguityRepairMigrationPath, 'utf8');
}

async function readProductCatalogMigration() {
  return readFile(productCatalogMigrationPath, 'utf8');
}

async function readAtomicProductCommissionMigration() {
  return readFile(atomicProductCommissionMigrationPath, 'utf8');
}

async function readDefaultCommissionRuleMigration() {
  return readFile(defaultCommissionRuleMigrationPath, 'utf8');
}

async function readHardDeleteMigration() {
  return readFile(hardDeleteMigrationPath, 'utf8');
}

function assertServerDmlSecurityContract(sql) {
  const grants = sql.match(/\bGRANT\b[\s\S]*?;/gi) ?? [];

  for (const grant of grants) {
    const grantees = grant.match(/\bTO\b\s+([\s\S]*?);$/i)?.[1] ?? '';

    for (const browserRole of ['PUBLIC', 'anon', 'authenticated']) {
      assert.doesNotMatch(
        grantees,
        new RegExp(`(?:^|,)\\s*${browserRole}\\b`, 'i'),
        `server DML migration must not grant privileges to browser role ${browserRole}`,
      );
    }
  }

  const alteredTables = sql.match(/\bALTER\s+TABLE\b[\s\S]*?;/gi) ?? [];
  for (const alteredTable of alteredTables) {
    assert.doesNotMatch(
      alteredTable,
      /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i,
      'server DML migration must not disable row level security',
    );
  }
}

function tableDefinition(sql, table) {
  const match = sql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i'));
  assert.ok(match, `missing public.${table} table definition`);
  return match[1];
}

function paymentFunctionDefinition(sql) {
  const match = sql.match(/CREATE FUNCTION public\.mark_commissions_paid[\s\S]*?\n\$\$;/i);
  assert.ok(match, 'missing mark_commissions_paid function definition');
  return match[0];
}

test('migration static contract keeps finance tables private and payment RPC restricted', async () => {
  const sql = await readMigration();

  for (const table of [
    'profiles',
    'commissions',
    'payment_batches',
    'commission_payment_events',
    'bootstrap_locks',
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
  }

  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /CREATE FUNCTION public\.mark_commissions_paid/);
  assert.match(sql, /WHERE c\.status = 'pending'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mark_commissions_paid\(uuid\[\], uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mark_commissions_paid\(uuid\[\], uuid\) TO service_role/);
});

test('session registry migration permits access only through the service role', async () => {
  const sql = await readSessionRegistryMigration();
  const registry = tableDefinition(sql, 'app_session_registry');

  assert.match(registry, /session_id uuid primary key/);
  assert.match(registry, /user_id uuid not null references auth\.users\(id\) on delete restrict/);
  assert.match(registry, /created_at timestamptz not null default now\(\)/);
  assert.match(registry, /revoked_at timestamptz/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.app_session_registry FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.app_session_registry TO service_role/);
  assert.match(sql, /ALTER TABLE public\.app_session_registry ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.app_session_registry FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
});

test('server DML migration grants only service_role access to protected tables', async () => {
  const sql = await readServerDmlMigration();

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  for (const table of [
    'profiles',
    'commissions',
    'payment_batches',
    'commission_payment_events',
    'bootstrap_locks',
    'app_session_registry',
  ]) {
    assert.match(
      sql,
      new RegExp(
        `GRANT\\s+SELECT,\\s+INSERT,\\s+UPDATE,\\s+DELETE\\s+ON TABLE public\\.${table}\\s+TO service_role;`,
        'i',
      ),
    );
  }

  assertServerDmlSecurityContract(sql);
});

test('server DML migration static contract rejects browser roles in multi-grantee grants', () => {
  for (const browserRole of ['PUBLIC', 'anon', 'authenticated']) {
    const sql = `GRANT SELECT ON TABLE public.profiles TO service_role, ${browserRole};`;

    assert.throws(
      () => assertServerDmlSecurityContract(sql),
      new RegExp(`must not grant privileges to browser role ${browserRole}`, 'i'),
    );
  }
});

test('seller profile migration constrains nullable normalized contact and default rate without RLS changes', async () => {
  const sql = await readSellerFieldsMigration();

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(sql, /ALTER TABLE public\.profiles/);
  assert.match(sql, /ADD COLUMN phone text/);
  assert.doesNotMatch(sql, /ADD COLUMN phone text NOT NULL/i);
  assert.match(sql, /CHECK \(phone IS NULL OR phone ~ '\^\[0-9\]\{10,15\}\$'\)/i);
  assert.match(sql, /ADD COLUMN default_commission_rate_bps integer/);
  assert.doesNotMatch(sql, /ADD COLUMN default_commission_rate_bps integer NOT NULL/i);
  assert.match(sql, /CHECK \(default_commission_rate_bps IS NULL OR default_commission_rate_bps BETWEEN 0 AND 10000\)/i);
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE|CREATE POLICY|DISABLE ROW LEVEL SECURITY)\b/i);
});

test('administrator migration removes only the single-admin index without weakening database access controls', async () => {
  const sql = await readMultipleAdministratorsMigration();

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(sql, /DROP INDEX IF EXISTS public\.profiles_one_admin_idx;/i);
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE|CREATE POLICY|DISABLE ROW LEVEL SECURITY)\b/i);
});

test('archival audit migration atomically archives profiles and records a protected audit event', async () => {
  const sql = await readArchivalAuditMigration();
  const functionMatch = sql.match(/CREATE FUNCTION public\.archive_profile[\s\S]*?\n\$\$;/i);

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS archived_at timestamptz/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS archived_by uuid references public\.profiles\(id\) on delete restrict/i);
  assert.match(sql, /CREATE TABLE public\.profile_archive_events/i);
  for (const column of ['actor_id uuid not null', 'target_id uuid not null', 'target_role public\.app_role not null', 'target_display_name text not null', 'archived_at timestamptz not null']) {
    assert.match(sql, new RegExp(column, 'i'));
  }
  assert.match(sql, /ALTER TABLE public\.profile_archive_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE public\.profile_archive_events FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.profile_archive_events FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE public\.profile_archive_events TO service_role/i);
  assert.ok(functionMatch, 'missing archive_profile function');
  assert.match(functionMatch[0], /security definer/i);
  assert.match(functionMatch[0], /set search_path = ''/i);
  for (const builtin of ['pg_catalog\.clock_timestamp', 'pg_catalog\.hashtext', 'pg_catalog\.pg_advisory_xact_lock']) {
    assert.match(functionMatch[0], new RegExp(builtin, 'i'));
  }
  assert.match(functionMatch[0], /p_target_id = p_actor_id/i);
  assert.match(functionMatch[0], /FOR UPDATE/i);
  assert.match(functionMatch[0], /count\(\*\).*role = 'admin'.*active = true.*archived_at is null/is);
  assert.match(functionMatch[0], /update public\.profiles[\s\S]*active = false[\s\S]*archived_at = v_archived_at/is);
  assert.match(functionMatch[0], /insert into public\.profile_archive_events/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.archive_profile\(uuid, uuid\) FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.archive_profile\(uuid, uuid\) TO service_role/i);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
});

test('expected-role archive migration replaces the RPC and rejects a cross-role target before mutation or audit', async () => {
  const sql = await readArchivalExpectedRoleMigration();
  const functionMatch = sql.match(/CREATE(?: OR REPLACE)? FUNCTION public\.archive_profile[\s\S]*?\n\$\$;/i);

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.archive_profile\(uuid, uuid\);/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.archive_profile/i);
  assert.ok(functionMatch, 'missing three-argument archive_profile function');

  const archiveFunction = functionMatch[0];
  assert.match(
    archiveFunction,
    /CREATE(?: OR REPLACE)? FUNCTION public\.archive_profile\(\s*p_target_id uuid,\s*p_actor_id uuid,\s*p_expected_role public\.app_role\s*\)/i,
  );
  assert.match(archiveFunction, /SECURITY DEFINER/i);
  assert.match(archiveFunction, /SET search_path = ''/i);
  for (const builtin of ['pg_catalog\.clock_timestamp', 'pg_catalog\.hashtext', 'pg_catalog\.pg_advisory_xact_lock', 'pg_catalog\.count']) {
    assert.match(archiveFunction, new RegExp(builtin, 'i'));
  }
  assert.match(
    archiveFunction,
    /WHERE id = p_target_id\s+AND archived_at IS NULL\s+FOR UPDATE;\s+IF NOT FOUND OR v_target\.role <> p_expected_role THEN\s+RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';/is,
  );

  const expectedRoleCheck = archiveFunction.indexOf('IF NOT FOUND OR v_target.role <> p_expected_role THEN');
  const profileUpdate = archiveFunction.indexOf('UPDATE public.profiles');
  const auditInsert = archiveFunction.indexOf('INSERT INTO public.profile_archive_events');
  assert.ok(expectedRoleCheck >= 0 && expectedRoleCheck < profileUpdate, 'expected role must be checked before the profile update');
  assert.ok(expectedRoleCheck >= 0 && expectedRoleCheck < auditInsert, 'expected role must be checked before the audit insert');
  assert.equal((archiveFunction.match(/UPDATE public\.profiles\b/gi) ?? []).length, 1);
  assert.equal((archiveFunction.match(/INSERT INTO public\.profile_archive_events\b/gi) ?? []).length, 1);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.archive_profile\(uuid, uuid, public\.app_role\) FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.archive_profile\(uuid, uuid, public\.app_role\) TO service_role/i);
  assert.doesNotMatch(sql, /\b(?:ALTER TABLE|CREATE TABLE|DROP TABLE)\b/i);
});

test('PostgREST schema reload migration refreshes the archive RPC signature without changing database privileges', async () => {
  const sql = await readPostgrestSchemaReloadMigration();

  assert.match(sql, /^\s*BEGIN;\s*NOTIFY pgrst, 'reload schema';\s*COMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:CREATE|DROP|ALTER|GRANT|REVOKE)\b/i);
});

test('archive ambiguity repair qualifies archived_at against profile aliases and reloads PostgREST', async () => {
  const sql = await readArchivalAmbiguityRepairMigration();

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.archive_profile/i);
  assert.match(sql, /FROM public\.profiles AS target_profile\s+WHERE target_profile\.id = p_target_id\s+AND target_profile\.archived_at IS NULL/is);
  assert.match(sql, /FROM public\.profiles AS active_admin\s+WHERE active_admin\.role = 'admin'\s+AND active_admin\.active = true\s+AND active_admin\.archived_at IS NULL/is);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/i);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path = ''/i);
  assert.doesNotMatch(sql, /\b(?:ALTER TABLE|CREATE TABLE|DROP TABLE)\b/i);
});

test('product catalog migration keeps product rules private and recalculates only pending commissions', async () => {
  const sql = await readProductCatalogMigration();
  const functionMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.update_product_rule[\s\S]*?\n\$\$;/i);

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(sql, /CREATE TABLE public\.products/i);
  assert.match(sql, /CREATE UNIQUE INDEX products_name_normalized_idx\s+ON public\.products \(name_normalized\)/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public\.products\(id\) ON DELETE RESTRICT/i);
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS product_id uuid NOT NULL/i);
  assert.match(sql, /CREATE TABLE public\.product_rule_events/i);
  assert.match(sql, /ALTER TABLE public\.products ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE public\.products FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE public\.product_rule_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE public\.product_rule_events FORCE ROW LEVEL SECURITY/i);
  assert.ok(functionMatch, 'missing update_product_rule function definition');

  const updateProductRule = functionMatch[0];
  assert.match(
    updateProductRule,
    /CREATE OR REPLACE FUNCTION public\.update_product_rule\(\s*p_product_id uuid,\s*p_actor_id uuid,\s*p_name text,\s*p_commission_type public\.commission_type,\s*p_commission_rate_bps integer,\s*p_commission_fixed_cents bigint\s*\)/i,
  );
  assert.match(updateProductRule, /RETURNS TABLE \(\s*product_id uuid,\s*recalculated_pending_count integer\s*\)/i);
  assert.match(updateProductRule, /SECURITY DEFINER/i);
  assert.match(updateProductRule, /SET search_path = public/i);
  assert.match(updateProductRule, /FOR UPDATE/i);
  assert.match(updateProductRule, /v_product\.active IS NOT TRUE/i);
  assert.match(updateProductRule, /INSERT INTO public\.product_rule_events/i);
  assert.match(updateProductRule, /UPDATE public\.commissions AS c/i);
  assert.match(updateProductRule, /WHERE c\.status = 'pending'/i);
  assert.match(updateProductRule, /commission_type = p_commission_type/i);
  assert.match(updateProductRule, /commission_rate_bps = CASE WHEN p_commission_type = 'percentage' THEN p_commission_rate_bps ELSE NULL END/i);
  assert.match(updateProductRule, /commission_fixed_cents = CASE WHEN p_commission_type = 'fixed' THEN p_commission_fixed_cents ELSE NULL END/i);
  assert.match(updateProductRule, /GET DIAGNOSTICS v_recalculated_pending_count = ROW_COUNT/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.products FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.product_rule_events FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.products TO service_role/i);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE public\.product_rule_events TO service_role/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.update_product_rule\(uuid, uuid, text, public\.commission_type, integer, bigint\) FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.update_product_rule\(uuid, uuid, text, public\.commission_type, integer, bigint\) TO service_role/i);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/i);
  assert.doesNotMatch(sql, /GRANT .* TO (PUBLIC|anon|authenticated)/i);
});

test('atomic product-backed commission migration locks the active product and restricts the RPC', async () => {
  const sql = await readAtomicProductCommissionMigration();
  const functionMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.upsert_product_backed_commission[\s\S]*?\n\$\$;/i);

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.ok(functionMatch, 'missing atomic product-backed commission function definition');
  const upsertProductBackedCommission = functionMatch[0];
  assert.match(upsertProductBackedCommission, /p_commission_id uuid/i);
  assert.match(upsertProductBackedCommission, /p_actor_id uuid/i);
  assert.match(upsertProductBackedCommission, /p_product_id uuid/i);
  assert.match(upsertProductBackedCommission, /SECURITY DEFINER/i);
  assert.match(upsertProductBackedCommission, /SELECT \*\s+INTO v_product\s+FROM public\.products\s+WHERE id = p_product_id\s+AND active = true\s+FOR UPDATE/is);
  assert.match(upsertProductBackedCommission, /INSERT INTO public\.commissions/i);
  assert.match(upsertProductBackedCommission, /UPDATE public\.commissions/i);
  assert.match(upsertProductBackedCommission, /status = 'pending'/i);
  assert.match(upsertProductBackedCommission, /commission_type = v_product\.commission_type/i);
  assert.match(upsertProductBackedCommission, /commission_rate_bps = v_product\.commission_rate_bps/i);
  assert.match(upsertProductBackedCommission, /commission_fixed_cents = v_product\.commission_fixed_cents/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.upsert_product_backed_commission\(uuid, uuid, uuid, text, uuid, bigint, date, text\) FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.upsert_product_backed_commission\(uuid, uuid, uuid, text, uuid, bigint, date, text\) TO service_role/i);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/i);
  assert.doesNotMatch(sql, /GRANT .* TO (PUBLIC|anon|authenticated)/i);
});

test('server DML migration static contract rejects RLS disabling statements', () => {
  const sql = 'ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;';

  assert.throws(
    () => assertServerDmlSecurityContract(sql),
    /must not disable row level security/i,
  );
});

test('migration static contract rounds percentage commissions at the final cent', async () => {
  const commissions = tableDefinition(await readMigration(), 'commissions');
  const roundedProbe = (999n * 1050n + 5000n) / 10000n;

  assert.equal(roundedProbe, 105n);
  assert.match(
    commissions,
    /when 'percentage' then \(sale_value_cents \* commission_rate_bps \+ 5000\) \/ 10000/,
  );
});

test('migration static contract defines normalized profile lookups and display data', async () => {
  const profiles = tableDefinition(await readMigration(), 'profiles');

  assert.match(profiles, /email text not null unique/);
  assert.match(profiles, /username text not null/);
  assert.match(profiles, /username_normalized text not null unique/);
  assert.match(profiles, /display_name text not null/);
  assert.match(profiles, /email = lower\(btrim\(email\)\) and email <> ''/);
  assert.match(
    profiles,
    /username_normalized = lower\(btrim\(username_normalized\)\) and username_normalized <> ''/,
  );
  assert.match(profiles, /role public\.app_role not null/);
  assert.match(profiles, /active boolean not null default true/);
  assert.match(profiles, /session_not_before timestamptz not null default 'epoch'::timestamptz/);
  assert.match(profiles, /created_at timestamptz not null default now\(\)/);
  assert.match(profiles, /updated_at timestamptz not null default now\(\)/);
});

test('migration static contract bounds commission inputs and keeps the formula bigint-safe', async () => {
  const commissions = tableDefinition(await readMigration(), 'commissions');
  const maximumRoundedNumerator = maxMonetaryCents * maxBasisPoints + 5000n;

  assert.ok(maximumRoundedNumerator <= maxSignedBigint);
  assert.match(commissions, /seller_name_snapshot text not null/);
  assert.match(commissions, /product text not null/);
  assert.match(commissions, /char_length\(btrim\(product\)\) between 1 and 200/);
  assert.match(commissions, /sale_value_cents bigint not null/);
  assert.match(commissions, /sale_value_cents between 1 and 900000000000000/);
  assert.match(commissions, /commission_rate_bps between 1 and 10000/);
  assert.match(commissions, /commission_fixed_cents between 1 and 900000000000000/);
  assert.match(commissions, /commission_type = 'percentage'[\s\S]*commission_fixed_cents is null/);
  assert.match(commissions, /commission_type = 'fixed'[\s\S]*commission_rate_bps is null/);
});

test('migration static contract records pending-to-paid audit transitions', async () => {
  const sql = await readMigration();
  const events = tableDefinition(sql, 'commission_payment_events');
  const paymentFunction = paymentFunctionDefinition(sql);

  assert.match(events, /previous_status public\.commission_status not null/);
  assert.match(events, /new_status public\.commission_status not null/);
  assert.match(
    paymentFunction,
    /insert into public\.commission_payment_events(?: as payment_event)? \([\s\S]*previous_status,[\s\S]*new_status,[\s\S]*\)/,
  );
  assert.match(
    paymentFunction,
    /select[\s\S]*updated\.id,[\s\S]*new_batch\.id,[\s\S]*p_actor_id,[\s\S]*'paid',[\s\S]*'pending',[\s\S]*'paid',[\s\S]*v_paid_at/,
  );
});

test('migration static contract aliases inserted payment event output before returning it', async () => {
  const paymentFunction = paymentFunctionDefinition(await readMigration());

  assert.match(
    paymentFunction,
    /returning\s+payment_event\.commission_id\s+as\s+event_commission_id,\s+payment_event\.payment_batch_id\s+as\s+event_payment_batch_id/,
  );
  assert.match(
    paymentFunction,
    /select\s+updated\.id,\s+updated\.paid_at,\s+inserted_events\.event_payment_batch_id\s+from\s+updated\s+join\s+inserted_events\s+on\s+inserted_events\.event_commission_id\s+=\s+updated\.id/i,
  );
});

test('void migration adds commission fields and restricts cancellation to pending commissions', async () => {
  const sql = await readVoidCommissionMigration();
  const functionMatch = sql.match(/CREATE FUNCTION public\.void_commission[\s\S]*?\n\$\$;/i);

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS sale_date date NOT NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS note text NOT NULL/);
  assert.ok(functionMatch, 'missing void_commission function definition');
  assert.match(functionMatch[0], /security definer/);
  assert.match(functionMatch[0], /set search_path = public/);
  assert.match(functionMatch[0], /update public\.commissions as c/);
  assert.match(functionMatch[0], /set\s+status = 'voided'/);
  assert.match(functionMatch[0], /where c\.status = 'pending'\s+and c\.id = p_commission_id/i);
  assert.match(functionMatch[0], /'voided',\s+'pending',\s+'voided'/);
  assert.doesNotMatch(functionMatch[0], /delete\s+from\s+public\.commissions/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.void_commission\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.void_commission\(uuid, uuid\) TO service_role/);
});

test('repair migration atomically replaces the payment RPC with qualified output aliases', async () => {
  const sql = await readRepairMigration();
  const functionMatch = sql.match(
    /CREATE OR REPLACE FUNCTION public\.mark_commissions_paid[\s\S]*?\n\$\$;/i,
  );
  const begin = sql.search(/^\s*BEGIN;/im);
  const commit = sql.search(/^COMMIT;\s*$/im);
  const createFunction = sql.indexOf('CREATE OR REPLACE FUNCTION public.mark_commissions_paid');
  const revokeFunction = sql.indexOf('REVOKE ALL ON FUNCTION public.mark_commissions_paid');
  const grantFunction = sql.indexOf('GRANT EXECUTE ON FUNCTION public.mark_commissions_paid');

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.ok(functionMatch, 'missing replacement mark_commissions_paid function definition');
  assert.match(functionMatch[0], /security definer/);
  assert.match(functionMatch[0], /set search_path = public/);
  assert.match(
    functionMatch[0],
    /returning\s+payment_event\.commission_id\s+as\s+event_commission_id,\s+payment_event\.payment_batch_id\s+as\s+event_payment_batch_id/,
  );
  assert.match(
    functionMatch[0],
    /select\s+updated\.id,\s+updated\.paid_at,\s+inserted_events\.event_payment_batch_id\s+from\s+updated\s+join\s+inserted_events\s+on\s+inserted_events\.event_commission_id\s+=\s+updated\.id/i,
  );
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mark_commissions_paid\(uuid\[\], uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mark_commissions_paid\(uuid\[\], uuid\) TO service_role/);
  assert.ok(begin >= 0);
  assert.ok(commit > begin);
  for (const statement of [createFunction, revokeFunction, grantFunction]) {
    assert.ok(statement > begin && statement < commit);
  }
});

test('migration static contract wraps the privileged function grant in one transaction', async () => {
  const sql = await readMigration();
  const begin = sql.search(/^\s*BEGIN;/im);
  const commit = sql.search(/^COMMIT;\s*$/im);
  const createFunction = sql.indexOf('CREATE FUNCTION public.mark_commissions_paid');
  const revokeFunction = sql.indexOf('REVOKE ALL ON FUNCTION public.mark_commissions_paid');
  const grantFunction = sql.indexOf('GRANT EXECUTE ON FUNCTION public.mark_commissions_paid');

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.ok(begin >= 0);
  assert.ok(commit > begin);
  for (const statement of [createFunction, revokeFunction, grantFunction]) {
    assert.ok(statement > begin && statement < commit);
  }
});

test('default commission rule migration protects default-backed pending commissions', async () => {
  const sql = await readDefaultCommissionRuleMigration();
  const defaultRuleFunction = sql.match(
    /CREATE OR REPLACE FUNCTION public\.update_default_commission_rule[\s\S]*?\n\$\$;/i,
  )?.[0];
  const defaultBackedCommissionFunction = sql.match(
    /CREATE OR REPLACE FUNCTION public\.upsert_default_backed_commission[\s\S]*?\n\$\$;/i,
  )?.[0];

  assert.match(sql, /CREATE TABLE public\.commission_default_rule/i);
  assert.match(sql, /PRIMARY KEY \(id\).*CHECK \(id\)/is);
  assert.match(sql, /INSERT INTO public\.commission_default_rule \(id, configured\) VALUES \(true, false\)/i);
  assert.match(sql, /CREATE TABLE public\.commission_default_rule_events/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_default_commission_rule\(/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.upsert_default_backed_commission\(/i);
  assert.ok(defaultRuleFunction, 'missing update_default_commission_rule function definition');
  assert.ok(defaultBackedCommissionFunction, 'missing upsert_default_backed_commission function definition');
  assert.match(sql, /FOR UPDATE/i);
  assert.match(defaultRuleFunction, /UPDATE public\.commissions AS commission[\s\S]*?WHERE commission\.status = 'pending'\s+AND commission\.product_id IS NULL;/i);
  assert.match(defaultBackedCommissionFunction, /v_updated_at timestamptz := pg_catalog\.clock_timestamp\(\)/i);
  assert.match(
    defaultBackedCommissionFunction,
    /UPDATE public\.commissions AS commission[\s\S]*?updated_at = v_updated_at[\s\S]*?WHERE commission\.id = p_commission_id\s+AND commission\.status = 'pending'\s+RETURNING \* INTO v_commission;/i,
  );
  assert.doesNotMatch(
    defaultBackedCommissionFunction,
    /WHERE commission\.id = p_commission_id\s+AND commission\.status = 'pending'\s+AND commission\.product_id IS NULL/i,
  );
  assert.doesNotMatch(sql, /status = 'paid'[\s\S]*product_id IS NULL[\s\S]*UPDATE public\.commissions/is);
  assert.match(sql, /DROP COLUMN IF EXISTS default_commission_rate_bps/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.commission_default_rule FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.update_default_commission_rule[\s\S]* TO service_role/i);
});

test('hard delete migration exposes service-role-only atomic deletion RPCs', async () => {
  const sql = await readHardDeleteMigration();

  assert.match(sql, /^\s*BEGIN;[\s\S]*COMMIT;\s*$/i);

  for (const [signature, createSignature] of [
    ['public\\.delete_commission\\(uuid, uuid\\)', 'public\\.delete_commission\\(p_commission_id uuid, p_actor_id uuid\\)'],
    ['public\\.delete_seller\\(uuid, uuid\\)', 'public\\.delete_seller\\(p_target_id uuid, p_actor_id uuid\\)'],
    ['public\\.delete_product\\(uuid, uuid\\)', 'public\\.delete_product\\(p_product_id uuid, p_actor_id uuid\\)'],
  ]) {
    assert.match(sql, new RegExp(`CREATE FUNCTION ${createSignature}`));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`));
  }

  const commissionFunction = sql.match(/CREATE FUNCTION public\.delete_commission[\s\S]*?\n\$\$;/i)?.[0];
  const sellerFunction = sql.match(/CREATE FUNCTION public\.delete_seller[\s\S]*?\n\$\$;/i)?.[0];
  const productFunction = sql.match(/CREATE FUNCTION public\.delete_product[\s\S]*?\n\$\$;/i)?.[0];
  assert.ok(commissionFunction, 'missing delete_commission definition');
  assert.ok(sellerFunction, 'missing delete_seller definition');
  assert.ok(productFunction, 'missing delete_product definition');

  assert.match(commissionFunction, /RETURNS TABLE \(deleted_commission_id uuid\)/i);
  assert.match(sellerFunction, /RETURNS TABLE \(deleted_seller_id uuid\)/i);
  assert.match(productFunction, /RETURNS TABLE \(deleted_product_id uuid\)/i);

  for (const definition of [commissionFunction, sellerFunction, productFunction]) {
    assert.match(definition, /security definer/i);
    assert.match(definition, /set search_path = ''/i);
    assert.match(definition, /v_actor\.role <> 'admin'/);
    assert.match(definition, /FOR UPDATE/i);
  }

  assert.match(commissionFunction, /DELETE FROM public\.commission_payment_events\s+WHERE commission_id = p_commission_id;/i);
  assert.match(commissionFunction, /DELETE FROM public\.commissions\s+WHERE id = p_commission_id;/i);
  assert.doesNotMatch(commissionFunction, /DELETE FROM public\.profiles/i);

  assert.match(sellerFunction, /v_target\.role <> 'seller'/);
  assert.match(sellerFunction, /DELETE FROM public\.commissions\s+WHERE seller_id = p_target_id;/i);
  assert.match(sellerFunction, /DELETE FROM public\.app_session_registry\s+WHERE user_id = p_target_id;/i);
  assert.match(sellerFunction, /DELETE FROM public\.profile_archive_events\s+WHERE target_id = p_target_id;/i);
  assert.match(sellerFunction, /DELETE FROM public\.profiles\s+WHERE id = p_target_id;/i);

  assert.match(productFunction, /IF EXISTS \(SELECT 1 FROM public\.commissions WHERE product_id = p_product_id\)/i);
  assert.match(productFunction, /ERRCODE = '23503'/);
  assert.match(productFunction, /DELETE FROM public\.products\s+WHERE id = p_product_id;/i);

  assert.match(sql, /NOTIFY pgrst, 'reload schema'/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
});
