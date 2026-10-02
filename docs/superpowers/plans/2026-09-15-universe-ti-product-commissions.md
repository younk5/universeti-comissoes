# Universe TI Product Commission Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only individual product catalog with fixed or percentage commission rules, automatic commission snapshots, and safe recalculation of pending commissions after a product-rule change.

**Architecture:** Extend the existing Supabase/PostgreSQL model with private products, nullable commission `product_id`, protected audit events, and a transactionally safe product-rule RPC. The Express API is the sole browser-facing business layer; it resolves and validates product rules server-side. The existing vanilla-JS administrator view gains a Produtos tab and product-select commission form without changing seller capabilities.

**Tech Stack:** PostgreSQL/Supabase migrations, Express 5, Supabase JS service-role client, Vite 8, vanilla JavaScript, Node test runner, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-15-universe-ti-product-commissions.md`

## Global Constraints

- Only active administrators manage products; sellers receive no product endpoints or direct table access.
- Product rules are individual only; no product groups.
- Product rule type is `fixed` or `percentage`, with cents and basis-points as the only financial source of truth.
- Edit rule recalculates only linked `pending` commissions; `paid` and `voided` values must be immutable.
- Products are deactivated logically, never deleted; inactive items remain visible in historical commissions.
- Browser cannot authoritatively set a catalog rule for a commission: server resolves the active product and persists the snapshot.
- No dependencies, remote assets, localStorage finance data, or changes to authentication/RLS posture.
- Do not deploy a function that calls the new RPC until its migration is applied and confirmed in Production.

---

## File Structure

- `supabase/migrations/202609150001_add_product_catalog.sql`: private products, nullable `commissions.product_id`, durable product-rule audit, constraints, restricted grants, update RPC.
- `src/server/domain/products.js`: validation/normalization for product payloads and exact serialization.
- `src/server/services/product-service.js`: admin-scoped product CRUD, inactive handling, safe RPC invocation.
- `src/server/services/commission-service.js`: product-aware creation/update, server-side rule snapshot, product lookup contracts.
- `src/server/routes/product-routes.js`: authenticated admin endpoints.
- `src/server/app.js`: product router composition.
- `src/client/views/admin-view.js`: Produtos tab, catalogue loading/mutation, commission product select.
- `src/client/styles/app.css`: existing executive design rules for product controls only.
- `tests/unit/products.test.js`, `tests/unit/product-service.test.js`, `tests/api/products.test.js`: validation, service, and authorization coverage.
- Existing `tests/unit/admin-view.test.js`, `tests/api/commissions.test.js`, `tests/unit/commission-service.test.js`, `tests/unit/supabase-migration.test.js`: product UI, commission invariant and migration contracts.

### Task 1: Add private product catalog migration and protected recalculation routine

**Files:**
- Create: `supabase/migrations/202609150001_add_product_catalog.sql`
- Modify: `tests/unit/supabase-migration.test.js`

**Interfaces:**
- Produces `public.products` and `public.product_rule_events` with no grants to `PUBLIC`, `anon`, or `authenticated`.
- Produces `public.update_product_rule(uuid, uuid, text, public.commission_type, integer, bigint)` callable only by `service_role`.
- RPC returns `product_id uuid, recalculated_pending_count integer`.

- [ ] **Step 1: Write migration static tests before migration**

Add tests that read the migration text and assert:

```js
assert.match(sql, /create table public\.products/i);
assert.match(sql, /product_id uuid.*references public\.products/i);
assert.match(sql, /create table public\.product_rule_events/i);
assert.match(sql, /create or replace function public\.update_product_rule/i);
assert.match(sql, /security definer/i);
assert.match(sql, /set search_path = public/i);
assert.match(sql, /c\.status = 'pending'/i);
assert.doesNotMatch(sql, /grant .* to (public|anon|authenticated)/i);
```

- [ ] **Step 2: Run the migration test to prove it fails**

Run: `node --test tests/unit/supabase-migration.test.js`

Expected: FAIL because migration `202609150001_add_product_catalog.sql` does not exist.

- [ ] **Step 3: Implement additive migration**

Create products with a normalized unique name index, one-of-two amount constraint, `active` default true and timestamps. Add nullable `commissions.product_id` foreign key with `ON DELETE RESTRICT`; leave legacy rows valid. Add product-rule event columns for actor, product, old/new type/rate/fixed amount, pending-count and timestamp.

The `update_product_rule` RPC must lock the product row, reject missing/inactive products and malformed amount combinations, store an audit event, then update linked commissions only when `status = 'pending'`. Set exact snapshots: percentage uses rule BPS and null fixed cents; fixed uses rule cents and null BPS. Return the count. Revoke all function/table privileges, then grant only to `service_role`. Include `NOTIFY pgrst, 'reload schema'` inside a transaction.

- [ ] **Step 4: Run static verification**

Run: `node --test tests/unit/supabase-migration.test.js && git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202609150001_add_product_catalog.sql tests/unit/supabase-migration.test.js
git commit -m "feat: add protected product commission catalog"
```

### Task 2: Add server-side product validation, service and routes

**Files:**
- Create: `src/server/domain/products.js`
- Create: `src/server/services/product-service.js`
- Create: `src/server/routes/product-routes.js`
- Modify: `src/server/app.js`
- Create: `tests/unit/products.test.js`
- Create: `tests/unit/product-service.test.js`
- Create: `tests/api/products.test.js`

**Interfaces:**
- `validateProductInput(input)` returns `{ name, commissionType, commissionRateBps, commissionFixedCents }`.
- `createProductService({ adminClient })` exposes `list`, `create`, `update`, `setActive`.
- Routes: `GET /api/products`, `POST /api/products`, `PATCH /api/products/:id`, `POST /api/products/:id/activate`, `POST /api/products/:id/deactivate`.

- [ ] **Step 1: Add failing validation and route tests**

Cover product trim/normalization, fixed/percentage exclusive amount requirements, active-admin authorization, seller 403, and inactive product rejection. Example:

```js
assert.deepEqual(validateProductInput({ name: ' Cabo USB-C ', commissionType: 'fixed', commissionInput: '20,00' }), {
  name: 'Cabo USB-C', commissionType: 'fixed', commissionRateBps: null, commissionFixedCents: 2000,
});
```

- [ ] **Step 2: Run targeted tests to establish failure**

Run: `node --test tests/unit/products.test.js tests/unit/product-service.test.js tests/api/products.test.js`

Expected: module-not-found failures.

- [ ] **Step 3: Implement domain, service and router**

Reuse `parseMoneyToCents` and `parsePercentageToBasisPoints`; reject product names outside 1–200 characters. Service must query explicit fields, call `update_product_rule` only for rule changes, return its recalculation count, reject reusing inactive products for mutation, and use logical active state only. Router applies the existing `requireActor` + `requireAdmin` chain; it never accepts actor IDs from browser payloads.

- [ ] **Step 4: Wire application and run focused tests**

Run: `node --test tests/unit/products.test.js tests/unit/product-service.test.js tests/api/products.test.js && npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/products.js src/server/services/product-service.js src/server/routes/product-routes.js src/server/app.js tests/unit/products.test.js tests/unit/product-service.test.js tests/api/products.test.js
git commit -m "feat: expose admin product catalog API"
```

### Task 3: Make commission creation and edits product-authoritative

**Files:**
- Modify: `src/server/services/commission-service.js`
- Modify: `src/server/domain/validation.js`
- Modify: `tests/unit/commission-service.test.js`
- Modify: `tests/api/commissions.test.js`

**Interfaces:**
- Commission creation accepts `productId`; server loads active catalog product and derives product snapshot/rule fields.
- Existing legacy commission rows with `productId: null` remain listable and exportable.
- Explicit manual commission rule may be used only when no catalog product is selected; existing current behavior remains for legacy/manual workflow until catalog use is selected.

- [ ] **Step 1: Write failing product-authority tests**

Assert that a request with a product ID whose browser body claims a different commission rate saves the product’s exact rate. Assert inactive/missing product returns a public validation/not-found error. Assert paid/voided update remains rejected and catalog rule update only changes pending snapshots through the RPC.

- [ ] **Step 2: Run tests to establish failure**

Run: `node --test tests/unit/commission-service.test.js tests/api/commissions.test.js`

Expected: failures because `productId` is unsupported.

- [ ] **Step 3: Implement product lookup and snapshots**

Extend explicit selection columns with `product_id`. When `productId` exists, query `products` using exact fields and `active = true`, overwrite input name/type/rule from product, and persist product snapshot text plus `product_id`. Preserve manual-path validation for `productId` absent so legacy flows remain compatible. In pending updates, product selection repeats the same server authority; paid/voided protection remains unchanged.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/unit/commission-service.test.js tests/api/commissions.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/commission-service.js src/server/domain/validation.js tests/unit/commission-service.test.js tests/api/commissions.test.js
git commit -m "feat: apply product rules to commission snapshots"
```

### Task 4: Add Productos tab and catalogue-backed commission form

**Files:**
- Modify: `src/client/views/admin-view.js`
- Modify: `src/client/styles/app.css`
- Modify: `tests/unit/admin-view.test.js`

**Interfaces:**
- Admin view loads `GET /api/products` after initial admin data; state holds product items and loading/failure generation guards.
- New `produtos` tab uses existing accessible tab pattern.
- Commission product select sends `productId`; manual rule controls remain usable only for legacy/manual selection.

- [ ] **Step 1: Add failing UI tests**

Test that the Produtos tab is a real keyboard-navigable tab, loads the catalogue, creates/edits/deactivates/activates via admin endpoints, announces recalculated pending count, and that selecting a fixed or percentage product fills rule controls and sends `productId` in the commission payload.

- [ ] **Step 2: Run focused view test to establish failure**

Run: `node --test tests/unit/admin-view.test.js`

Expected: failures for absent Produtos controls and product API calls.

- [ ] **Step 3: Implement accessible UI behavior**

Create a Produtos panel and matching tab after Comissões. Use explicit pt-BR labels, a selected active/inactive status, and an alert confirmation before rule edits: `As comissões pendentes deste produto serão recalculadas. Pagas e anuladas não serão alteradas.` Do not ask for password; the endpoint requires active admin. Disable conflicting actions while mutation is in flight, refresh local products/commissions after a successful rule edit, and report returned count with `aria-live` feedback.

In commission form, use `<select>` for active products, apply returned product rule as preview, retain exact currency formatting and mobile labels. Do not let client-calculated values replace server results.

- [ ] **Step 4: Add scoped styles**

Extend existing Universe TI forms/tables with product status and confirmation styles only. Preserve existing responsive breakpoint and no horizontal overflow.

- [ ] **Step 5: Run UI tests and checks**

Run: `node --test tests/unit/admin-view.test.js && npm run check && git diff --check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/views/admin-view.js src/client/styles/app.css tests/unit/admin-view.test.js
git commit -m "feat: manage commission products in admin"
```

### Task 5: Apply migration, verify, deploy and inspect production

**Files:**
- Modify only for concrete defects discovered by verification.

- [ ] **Step 1: Run full local verification**

Run: `npm test && npm run check && npm run build && git diff --check`

Expected: all tests pass and Vite build succeeds.

- [ ] **Step 2: Inspect migration before production**

Re-read the migration and validate every privileged routine has `SECURITY DEFINER`, explicit `search_path`, restricted execute grants and the `pending`-only status predicate. Apply it in authenticated Supabase SQL Editor; capture the successful SQL result. Do not test a destructive or financial product mutation on real records.

- [ ] **Step 3: Reload and deploy**

After migration success, confirm PostgREST reload signal is in the applied transaction, deploy with `npx.cmd vercel --prod --yes`, then validate `/health`, `/assets/universe-ti.svg`, and invalid `POST /api/auth/login` (401).

- [ ] **Step 4: Browser QA**

In a non-personal browser session, validate direct login, authenticated Products tab only if a safe existing admin session is available, keyboard tab navigation, form feedback, product select behavior, desktop/mobile zero overflow, and no legacy home surface.

- [ ] **Step 5: Commit QA repair only if required**

```bash
git add <only-repaired-files>
git commit -m "fix: resolve product catalog QA"
```

Skip if all checks pass.
