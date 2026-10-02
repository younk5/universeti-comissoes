# Galaxy Smart Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Galaxy Smart visual layer with a premium compact operational interface without changing product behavior.

**Architecture:** Preserve the existing Vite/vanilla JavaScript views and API contracts. Consolidate the interface system in `app.css`, then make only small, presentational markup changes when existing class hooks are insufficient. Keep the same DOM controls and semantic labels used by the tests.

**Tech Stack:** Vite, vanilla JavaScript, CSS, Node test runner, Supertest, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-14-galaxy-smart-visual-redesign.md`

## Global Constraints

- Preserve all authentication, API, permissions, finance, archive and audit behavior.
- Keep all operational copy in pt-BR.
- Do not add fonts, UI dependencies or icon libraries.
- Keep focus-visible states, labels, dialogs and mobile data labels accessible.
- Use dark graphite with controlled blue-violet accents; reserve red for destructive actions and errors.
- Avoid decorative emojis, generic AI visuals, content-area blur and behavior changes.

---

### Task 1: Establish the visual token system and application shell

**Files:**
- Modify: `src/client/styles/app.css:1-260`
- Test: `tests/unit/login-view.test.js`
- Test: `tests/unit/admin-view.test.js`

**Interfaces:**
- Consumes: existing `.app-shell`, `.session-shell`, `.session-header`, `.login-panel`, `.notice-panel`, `.button`, `.form-control` classes.
- Produces: stable tokenized global styles and unchanged interactive class contracts for all views.

- [ ] **Step 1: Write failing rendering assertions**

Add tests that retain the existing login fields, session header and tab controls after the visual wrappers are rendered.

```js
assert.equal(view.username.id, 'username');
assert.equal(view.password.type, 'password');
assert.equal(root.querySelector('[role="tablist"]') !== null, true);
```

- [ ] **Step 2: Run the affected tests**

Run: `node --test tests/unit/login-view.test.js tests/unit/admin-view.test.js`
Expected: PASS before CSS-only changes; these assertions are the presentation-contract guard.

- [ ] **Step 3: Implement the token and shell system**

Replace literal repeated colors with CSS custom properties for canvas, elevated surface, quiet surface, text, muted text, accent, danger, success, border and focus. Update global typography, background layers, application shell, session header, buttons and form controls while keeping class names and control dimensions usable.

```css
:root {
  --canvas: #0b0d14;
  --surface: #141824;
  --surface-raised: #1a2030;
  --text: #f4f6fb;
  --muted: #aeb6c8;
  --accent: #7b7cff;
  --ring: rgb(123 124 255 / 42%);
}
```

- [ ] **Step 4: Verify token/shell changes**

Run: `node --test tests/unit/login-view.test.js tests/unit/admin-view.test.js && npm run check`
Expected: all tests pass and JavaScript syntax checks pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/styles/app.css tests/unit/login-view.test.js tests/unit/admin-view.test.js
git commit -m "feat: establish premium Galaxy Smart visual system"
```

### Task 2: Redesign operational panels, forms, tables and dialogs

**Files:**
- Modify: `src/client/styles/app.css:261-1025`
- Modify: `src/client/views/admin-view.js`
- Modify: `src/client/views/seller-view.js`
- Test: `tests/unit/admin-view.test.js`
- Test: `tests/unit/seller-view.test.js`

**Interfaces:**
- Consumes: existing panel, form, table, feedback, confirmation-dialog and data-label class hooks.
- Produces: consistent dense desktop layout and single-column mobile layout without changing view behavior.

- [ ] **Step 1: Write failing responsive/semantic assertions**

Add or extend tests to ensure action buttons retain Portuguese operational labels, tables retain `data-label` values, and the confirmation dialog remains semantically available.

```js
assert.equal(view.sellerRows.children[0].children[5].getAttribute('data-label'), 'Ações');
assert.equal(view.confirmationDialog.getAttribute('aria-modal'), 'true');
```

- [ ] **Step 2: Run the focused tests**

Run: `node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js`
Expected: PASS before styling because these tests guard behavior and semantics.

- [ ] **Step 3: Implement panel and responsive styles**

Update the CSS for administrative tabs, grouped panels, summary metrics, filters, table headers/rows, action clusters, forms, empty states, feedback states and modal styling. Use a compact desktop grid, allow tab overflow only through intentional scrolling, and use the existing `data-label` mobile table pattern below the mobile breakpoint.

- [ ] **Step 4: Verify focused view tests**

Run: `node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js && npm run check`
Expected: all targeted tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/styles/app.css src/client/views/admin-view.js src/client/views/seller-view.js tests/unit/admin-view.test.js tests/unit/seller-view.test.js
git commit -m "feat: redesign Galaxy Smart operational surfaces"
```

### Task 3: Build, visual QA and production verification

**Files:**
- Modify: `src/client/styles/app.css` only if desktop/mobile QA finds a concrete visual defect.
- Test: full existing suite.

**Interfaces:**
- Consumes: completed CSS and unchanged API/view contracts.
- Produces: a deployable visual redesign validated locally and in production.

- [ ] **Step 1: Run full quality gates**

Run: `npm test && npm run check && npm run build && git diff --check`
Expected: all tests pass, build succeeds and no whitespace errors are reported.

- [ ] **Step 2: Start local preview and inspect desktop/mobile**

Run: `npm run dev -- --host 127.0.0.1 --port 4174`

Inspect the login shell and authenticated view styling at desktop and mobile widths. Verify no horizontal overflow, readable contrast, visible focus states and no clipped tab or table controls.

- [ ] **Step 3: Run the design detector**

Run: `node C:/Users/vinic/AppData/Local/hermes/skills/design/impeccable/scripts/detect.mjs --json src/client/styles/app.css src/client/views/admin-view.js src/client/views/seller-view.js`
Expected: no unresolved detector issue in changed visual targets.

- [ ] **Step 4: Deploy and verify production**

Run: `npx.cmd vercel --prod --yes`

Verify `/health` returns 200, invalid login returns application 401, and `npx.cmd vercel inspect <deployment-url>` reports Ready.

- [ ] **Step 5: Commit final QA fixes if required**

```bash
git add src/client/styles/app.css src/client/views/admin-view.js src/client/views/seller-view.js
git commit -m "fix: polish Galaxy Smart responsive design"
```
