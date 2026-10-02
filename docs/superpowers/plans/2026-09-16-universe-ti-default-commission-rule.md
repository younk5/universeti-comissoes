# Universe TI Default Commission Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a protected global fixed-or-percentage commission rule authoritative for every commission without a catalog product, while removing seller-specific and browser-entered commission rules.

**Architecture:** A singleton PostgreSQL row stores the default rule and is locked by both its update RPC and the non-catalog commission upsert RPC. Catalog-product commissions retain their existing product-locking RPC. Express exposes the default rule only to active administrators; the client uses it solely for display and preview, then submits only operational commission data.

**Tech Stack:** Node.js 22, Express 5, Supabase/PostgreSQL, Vite, native Node test runner, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-16-universe-ti-default-commission-rule.md`

## Global Constraints

- Product-specific rules always override the global rule.
- An unlisted product uses the configured global rule; if it is unconfigured, the server rejects the launch with a public actionable error.
- Financial source-of-truth values are integer cents and integer basis points; do not use floating point for authorization, persistence, or database calculation.
- Only pending commissions with `product_id IS NULL` are recalculated after a global-rule update. Product-backed, paid, and voided commissions remain unchanged.
- Browser commission payloads must not accept `commissionType` or `commissionInput`; server-side RPCs choose the stored rule.
- Remove `defaultCommissionRate` from seller UI, public API contracts, service metadata, and `profiles`; do not retain a silent fallback.
- Protected tables and functions must deny `PUBLIC`, `anon`, and `authenticated`; `service_role` is the only database grantee.
- Leave `reset-universe-ti-template.sql` untracked and untouched.
- Do not apply a migration to Production or deploy in this plan. Those actions recalculate live pending records and require a separate release confirmation.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/202609160001_add_default_commission_rule.sql` | Protected singleton, audit event, atomic update/upsert RPCs, seller-rate removal, grants, schema reload. |
| `src/server/domain/default-commission-rule.js` | Validate and serialize fixed/percentage global-rule data with exact integer conversions. |
| `src/server/services/default-commission-rule-service.js` | Active-admin reads and writes of the singleton through the protected RPC. |
| `src/server/routes/default-commission-rule-routes.js` | Authenticated API contract for `GET` and `PUT /api/commission-default-rule`. |
| `src/server/services/commission-service.js` | Send every commission to product-backed or default-backed RPC; never direct-write a rule. |
| `src/server/domain/validation.js` | Accept only operational commission fields and require a manual product name without `productId`. |
| `src/server/services/user-service.js` | Remove seller percentage parsing, storage, views, and Auth metadata. |
| `src/client/views/admin-view.js` | Rule-default editor, rule source preview, and removed seller/commission controls. |
| `src/client/styles/app.css` | Responsive layout for the default-rule card using existing Universe TI visual language. |
| `tests/unit/*.test.js`, `tests/api/*.test.js` | Migration, domain, service, route, and admin-view regression coverage. |

## Task 1: Create the protected default-rule database contract

**Files:**
- Create: `supabase/migrations/202609160001_add_default_commission_rule.sql`
- Modify: `tests/unit/supabase-migration.test.js`

**Interfaces:**
- Produces `public.commission_default_rule`, exactly one row with `id = true` and initially `configured = false`.
- Produces `public.update_default_commission_rule(uuid, public.commission_type, integer, bigint)` returning `recalculated_pending_count integer`.
- Produces `public.upsert_default_backed_commission(uuid, uuid, uuid, text, text, bigint, date, text)` returning `SETOF public.commissions`.
- Consumes existing `public.commissions`, `public.profiles`, `public.commission_type`, and the generated commission-value calculation already enforced by the commissions table.

- [ ] **Step 1: Write static migration tests before the migration exists**

Add one focused test to `tests/unit/supabase-migration.test.js` that reads `202609160001_add_default_commission_rule.sql` and asserts all of the following exact contracts:

```js
assert.match(sql, /CREATE TABLE public\.commission_default_rule/i);
assert.match(sql, /PRIMARY KEY \(id\).*CHECK \(id\)/is);
assert.match(sql, /INSERT INTO public\.commission_default_rule \(id, configured\) VALUES \(true, false\)/i);
assert.match(sql, /CREATE TABLE public\.commission_default_rule_events/i);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_default_commission_rule\(/i);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.upsert_default_backed_commission\(/i);
assert.match(sql, /FOR UPDATE/i);
assert.match(sql, /status = 'pending'[\s\S]*product_id IS NULL/i);
assert.doesNotMatch(sql, /status = 'paid'[\s\S]*product_id IS NULL[\s\S]*UPDATE public\.commissions/is);
assert.match(sql, /DROP COLUMN IF EXISTS default_commission_rate_bps/i);
assert.match(sql, /REVOKE ALL ON TABLE public\.commission_default_rule FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.update_default_commission_rule[\s\S]* TO service_role/i);
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test tests/unit/supabase-migration.test.js
```

Expected: FAIL because `202609160001_add_default_commission_rule.sql` does not exist.

- [ ] **Step 3: Write the migration**

Create the migration inside one `BEGIN`/`COMMIT` transaction with this database design:

```sql
CREATE TABLE public.commission_default_rule (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  configured boolean NOT NULL DEFAULT false,
  commission_type public.commission_type,
  commission_rate_bps integer,
  commission_fixed_cents bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_default_rule_amounts_check CHECK (
    (configured = false
      AND commission_type IS NULL
      AND commission_rate_bps IS NULL
      AND commission_fixed_cents IS NULL)
    OR
    (configured = true
      AND commission_type = 'percentage'
      AND commission_rate_bps BETWEEN 1 AND 10000
      AND commission_fixed_cents IS NULL)
    OR
    (configured = true
      AND commission_type = 'fixed'
      AND commission_rate_bps IS NULL
      AND commission_fixed_cents BETWEEN 1 AND 900000000000000)
  )
);

INSERT INTO public.commission_default_rule (id, configured) VALUES (true, false);
```

Create `commission_default_rule_events` with protected actor reference, nullable old-rule columns only for the first configuration, exact new-rule columns, `recalculated_pending_count >= 0`, and timestamp.

Implement `update_default_commission_rule` as `SECURITY DEFINER SET search_path = ''`. It must verify an active admin actor, lock `commission_default_rule WHERE id = true FOR UPDATE`, validate the supplied mutually exclusive rule values, lock only `commissions WHERE status = 'pending' AND product_id IS NULL`, update their stored rule inputs, insert one audit event, and return the row count. Do not update `paid`, `voided`, or product-backed commissions.

Implement `upsert_default_backed_commission` as `SECURITY DEFINER SET search_path = ''`. It must verify active admin actor, lock the singleton configured row, reject an unconfigured rule with a dedicated PostgreSQL error code, then insert or pending-only update the commission with `product_id = NULL`, the manual product snapshot, and the locked default rule values. The caller never supplies commission type, percentage, or fixed cents.

Drop `public.profiles.default_commission_rate_bps` and remove `galaxy_smart_default_commission_rate_bps` from `auth.users.raw_user_meta_data`. Enable and force RLS on both new tables; revoke browser roles from tables and RPCs; grant only necessary table/RPC privileges to `service_role`; end with `NOTIFY pgrst, 'reload schema'`.

- [ ] **Step 4: Run the migration tests and verify GREEN**

Run:

```bash
node --test tests/unit/supabase-migration.test.js
```

Expected: PASS, including the new static contract.

- [ ] **Step 5: Commit the database contract**

```bash
git add supabase/migrations/202609160001_add_default_commission_rule.sql tests/unit/supabase-migration.test.js
git commit -m "feat: add protected default commission rule"
```

## Task 2: Make the server the only commission-rule authority

**Files:**
- Create: `src/server/domain/default-commission-rule.js`
- Create: `src/server/services/default-commission-rule-service.js`
- Create: `src/server/routes/default-commission-rule-routes.js`
- Modify: `src/server/app.js`
- Modify: `src/server/domain/validation.js`
- Modify: `src/server/services/commission-service.js`
- Modify: `src/server/services/user-service.js`
- Modify: `tests/unit/commissions.test.js`
- Modify: `tests/unit/user-service.test.js`
- Create: `tests/unit/default-commission-rule-service.test.js`
- Create: `tests/api/default-commission-rule.test.js`
- Modify: `tests/api/commissions.test.js`
- Modify: `tests/api/users.test.js`

**Interfaces:**
- `validateDefaultCommissionRuleInput({ commissionType, commissionInput })` returns `{ commissionType, commissionRateBps, commissionFixedCents }`.
- `serializeDefaultCommissionRule(row)` returns `null` when `configured !== true`, otherwise `{ commissionType, commissionInput }` with an exact decimal string.
- `createDefaultCommissionRuleService({ adminClient })` returns `list({ actor })` and `update({ actor, input })`.
- `GET /api/commission-default-rule` returns `null` or `{ commissionType, commissionInput }`; `PUT` returns that rule plus `recalculatedPendingCount`.
- Commission create/update accepts only `sellerId`, optional `productId`, `product`, `saleValue`, `saleDate`, `note`; rules are selected by RPC.

- [ ] **Step 1: Write failing domain and service tests**

Create `tests/unit/default-commission-rule-service.test.js` with tests for:

```js
assert.deepEqual(validateDefaultCommissionRuleInput({
  commissionType: 'fixed', commissionInput: '20,00',
}), {
  commissionType: 'fixed', commissionRateBps: null, commissionFixedCents: 2000,
});

assert.deepEqual(serializeDefaultCommissionRule({
  configured: true, commission_type: 'percentage', commission_rate_bps: 1250,
  commission_fixed_cents: null,
}), { commissionType: 'percentage', commissionInput: '12.50' });

assert.equal(serializeDefaultCommissionRule({ configured: false }), null);
```

Add service tests proving inactive/seller actors are rejected before database access; a `list` selects only default-rule fields; and `update` calls `update_default_commission_rule` with the authenticated actor and exact integer values, returning the RPC count.

Extend `tests/unit/commissions.test.js` so a no-product create calls `upsert_default_backed_commission`, product create still calls `upsert_product_backed_commission`, and a forged `commissionType` or `commissionInput` fails before any database mutation.

Extend `tests/unit/user-service.test.js` to assert seller serialization, profile selects/inserts/updates, and Auth metadata omit `defaultCommissionRate` and `default_commission_rate_bps`.

- [ ] **Step 2: Run the targeted tests and verify RED**

Run:

```bash
node --test tests/unit/default-commission-rule-service.test.js tests/unit/commissions.test.js tests/unit/user-service.test.js
```

Expected: FAIL because the default-rule modules and default-backed RPC delegation do not exist, and current seller contracts still contain the removed field.

- [ ] **Step 3: Implement the default-rule domain, service, and route**

In `src/server/domain/default-commission-rule.js`, reuse `parseMoneyToCents` and `parsePercentageToBasisPoints` from validation; reject unknown/missing fields; serialize integer rule fields into the same `{ commissionType, commissionInput }` API shape used by products.

In `src/server/services/default-commission-rule-service.js`, require an active admin locally, select only `configured, commission_type, commission_rate_bps, commission_fixed_cents`, and use the protected RPC:

```js
const { data, error } = await adminClient.rpc('update_default_commission_rule', {
  p_actor_id: actor.id,
  p_commission_type: values.commissionType,
  p_commission_rate_bps: values.commissionRateBps,
  p_commission_fixed_cents: values.commissionFixedCents,
});
```

Create a dedicated router with `GET` and `PUT /commission-default-rule`, authenticate through the existing active-admin middleware, and strip every body property except `commissionType` and `commissionInput`. Mount this router in `src/server/app.js`.

- [ ] **Step 4: Route every commission through the correct locking RPC**

Refactor `validateCommissionInput` so it:

```js
const productId = normalizeProductId(input.productId);
return {
  sellerId: requireText(input.sellerId, 'Informe o vendedor.'),
  productId,
  product: productId ? String(input.product ?? '').trim() : requireText(input.product, 'Informe o produto ou serviço.'),
  saleValue: parseMoney(input.saleValue),
  saleDate: validateSaleDate(input.saleDate),
  note: String(input.note ?? '').trim(),
};
```

Reject `commissionType` and `commissionInput` in the commission service allowlist. Remove `commissionPayload` and all direct `insert`/`update` paths that persisted rule data. Add a `defaultBackedCommission` helper calling `upsert_default_backed_commission` with commission id, authenticated actor, seller snapshot, manual product, exact sale cents, date, and note. Translate the SQL unconfigured-rule error to a public `409 DEFAULT_COMMISSION_RULE_UNCONFIGURED` message directing the administrator to **Produtos**.

For a create or update, choose only one path: product ID calls the existing product RPC; no product ID calls the default RPC. Preserve pending-only and current-commission behavior for edits.

- [ ] **Step 5: Remove the seller-specific rule contract**

Simplify `src/server/services/user-service.js` by removing `parseDefaultCommissionRate`, default-rate Auth metadata, fallback handling for the dropped column, profile field persistence, `defaultCommissionRate` serialization, and every related input path. Keep optional telephone support unchanged. Explicitly reject `defaultCommissionRate` as an unknown seller input rather than accepting and ignoring it.

Update API route tests so `GET` and `PUT` of the default rule pass only `request.actor`, and seller routes expose no rate field. Update commission API tests to prove client rule fields are rejected and cannot override a configured default/product rule.

- [ ] **Step 6: Run targeted server tests and verify GREEN**

Run:

```bash
node --test tests/unit/default-commission-rule-service.test.js tests/unit/commissions.test.js tests/unit/user-service.test.js tests/api/default-commission-rule.test.js tests/api/commissions.test.js tests/api/users.test.js
```

Expected: PASS with no direct commission-rule writes outside RPCs.

- [ ] **Step 7: Commit the server authority layer**

```bash
git add src/server tests/unit tests/api
git commit -m "feat: apply default commission rule on server"
```

## Task 3: Replace the administrative controls and preserve usable previews

**Files:**
- Modify: `src/client/views/admin-view.js`
- Modify: `src/client/styles/app.css`
- Modify: `tests/unit/admin-view.test.js`

**Interfaces:**
- `state.defaultRule` holds `null` or `{ commissionType, commissionInput }`.
- `view.defaultRuleFields` exposes `{ commissionType, commissionInput }` for tests; seller and commission field objects no longer expose user-controlled rule fields.
- The commission payload contains no `commissionType` or `commissionInput`.

- [ ] **Step 1: Write the failing admin-view tests**

Replace current seller-rate and manual commission-rule assertions with tests that prove:

```js
assert.equal('defaultCommissionRate' in view.sellerFields, false);
assert.equal('commissionType' in view.commissionFields, false);
assert.equal('commissionInput' in view.commissionFields, false);
assert.doesNotMatch(root.textContent, /Percentual padrão/);
assert.doesNotMatch(root.textContent, /Tipo de comissão/);
assert.doesNotMatch(root.textContent, /Percentual ou valor/);
```

Add tests where the Products tab requests `/api/commission-default-rule`, renders its fixed and percentage values, submits `PUT` with only `{ commissionType, commissionInput }`, confirms the pending-only warning without a password field, refreshes the commission list after success, and retains newer data if an older default-rule request resolves last.

Add a commission-form test where an unlisted manual product submits only operational fields and a selected catalog product still sends only `productId` plus operational fields. Assert the preview labels its source as **produto selecionado** or **comissão padrão** and becomes actionable only when a default rule or active product rule is available.

- [ ] **Step 2: Run the admin-view test and verify RED**

Run:

```bash
node --test tests/unit/admin-view.test.js
```

Expected: FAIL because the seller percentage and commission type/value controls remain in the DOM and no default-rule endpoint is loaded.

- [ ] **Step 3: Implement the Products default-rule section**

Add state for `defaultRule`, `defaultRuleLoaded`, `defaultRulePending`, `defaultRuleGeneration`, and `defaultRuleMutationPending`. Create an `admin-form-section` above the product form with heading **Comissão padrão para itens sem regra individual**, a modality select, a numeric value control, feedback, and save button.

Load the catalog and default rule lazily and independently when the Products tab opens or the commission product selector receives focus. A late response must not overwrite a newer generation. Existing product catalog behavior must keep its stale-response protections.

On save, use the existing confirmation dialog with `requiresPassword: false` and the exact message:

```text
As comissões pendentes sem produto cadastrado serão recalculadas. Pagas, anuladas e produtos com regra própria não serão alterados.
```

Send `PUT /api/commission-default-rule`, save the returned rule/count, refresh the active commission filter, and announce the recalculated count. Disable only the controls participating in the request and always restore them in `finally`.

- [ ] **Step 4: Remove seller and manual commission rule controls**

Delete the seller-rate form control, header, data cell, editor reset/population, payload property, and returned public field. Adjust seller table empty states from six columns to five.

Delete the commission type/value controls, their listeners, their reset/edit assignments, and their payload properties. Keep the manual product-text field for unlisted products. Refactor preview selection to use the selected active product rule or `state.defaultRule`; when neither is available, render a neutral message such as `Configure a comissão padrão em Produtos para lançar itens fora do catálogo.` and prevent an invalid no-product submit locally without treating that as financial authority.

Keep the existing product-specific rule form unchanged. Add minimal CSS for the default-rule section and preserve current responsive form/table behavior without new decorative effects.

- [ ] **Step 5: Run admin-view tests and verify GREEN**

Run:

```bash
node --test tests/unit/admin-view.test.js
```

Expected: PASS, including default-rule loading/save, no stale state overwrite, removed controls, and the server-authoritative commission payload.

- [ ] **Step 6: Commit the administrative UI**

```bash
git add src/client/views/admin-view.js src/client/styles/app.css tests/unit/admin-view.test.js
git commit -m "feat: manage default commission rule in admin"
```

## Task 4: Verify the integrated artifact without releasing Production

**Files:**
- Modify if failures reveal integration defects: only files named in Tasks 1–3 and their focused tests.

**Interfaces:**
- The completed branch exposes a default-rule route, protected migration, no seller rate contract, and server-authoritative commission creation.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: every test passes with zero failures.

- [ ] **Step 2: Run static checks and production build**

Run:

```bash
npm run check && npm run build && git diff --check
```

Expected: exit status 0 for every command and a generated `dist/` build.

- [ ] **Step 3: Exercise the visual artifact locally**

Start the application using the project command, open the administrative UI in a desktop and mobile viewport, and verify:

1. Products shows the default-rule section before the product catalog.
2. Seller form/table contains no percentage-rate field or column.
3. Commission form contains no manual type/value fields.
4. A manual product shows the default-rule preview, while a catalog product shows its individual-rule preview.
5. Product-rule and default-rule controls remain usable and no horizontal overflow appears on mobile.

Stop the local server after the inspection.

- [ ] **Step 4: Inspect the complete diff and commit any test-driven integration repair**

Run:

```bash
git status --short
git diff --check HEAD~1..HEAD
git log --oneline --decorate -5
```

If verification found an implementation defect, first add a failing focused regression test, then fix only that defect, rerun its focused test plus the complete suite, and commit it as `fix: stabilize default commission rule integration`.

- [ ] **Step 5: Record release boundary**

Do not run the migration, deploy with Vercel, or change Supabase Production. Report the migration filename and that Production application will update pending non-catalog commissions only after the user explicitly authorizes the live release.
