# Galaxy Smart Executive Purple Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the executive graphite-and-purple visual system while preserving every current product behavior.

**Architecture:** Change the existing CSS visual tokens and presentational markup only. Keep the Vite/vanilla JavaScript view interfaces, API calls, semantics and test contracts unchanged.

**Tech Stack:** Vite, vanilla JavaScript, CSS, Node test runner, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-15-galaxy-smart-executive-purple-redesign.md`

## Global Constraints

- Preserve authentication, API, finance, permissions, archive and audit behavior.
- Keep all operational copy in pt-BR.
- Do not add dependencies, remote fonts or icon libraries.
- Keep keyboard focus, semantic labels, dialogs and responsive table data labels.

---

### Task 1: Apply executive purple tokens and wordmark treatment

**Files:**
- Modify: `src/client/styles/app.css`
- Modify: `public/assets/galaxy-mark.svg`
- Test: `tests/unit/login-view.test.js`

- [ ] Write a rendering assertion that keeps the wordmark SVG as the login source.
- [ ] Run `node --test tests/unit/login-view.test.js` and confirm it passes before style-only changes.
- [ ] Replace the incumbent palette with the specified graphite, white and restrained purple tokens; remove residual blue-specific visual styles from the shared layer.
- [ ] Ensure the wordmark remains icon-free and uses only “Galaxy” in white and “Smart” in purple.
- [ ] Run `node --test tests/unit/login-view.test.js && npm run check`.
- [ ] Commit with `git commit -m "feat: apply executive purple visual system"`.

### Task 2: Refine login and operational hierarchy

**Files:**
- Modify: `src/client/styles/app.css`
- Modify: `src/client/views/login-view.js` only if a presentational wrapper is required.
- Test: `tests/unit/admin-view.test.js`
- Test: `tests/unit/seller-view.test.js`

- [ ] Run the focused view tests and confirm current semantic contracts.
- [ ] Refine the login split layout, headers, metric surfaces, tabs, forms, tables and status colors to match the executive purple specification.
- [ ] Keep mobile layout stacked, data labels visible and touch targets unchanged.
- [ ] Run `node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js && npm run check`.
- [ ] Commit with `git commit -m "feat: refine executive commission surfaces"`.

### Task 3: Verify and publish

**Files:**
- Modify: `src/client/styles/app.css` only for concrete QA defects.

- [ ] Run `npm test && npm run check && npm run build && git diff --check`.
- [ ] Run the Impeccable detector on changed visual files.
- [ ] Deploy with `npx.cmd vercel --prod --yes`.
- [ ] Verify production health, invalid login and `/assets/galaxy-mark.svg` return application responses.
