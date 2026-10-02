# Universe TI Executive Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Galaxy Smart presentation with the Universe TI editorial executive home, corrected wordmark, and an accessible graphite-and-purple operational interface.

**Architecture:** Keep the existing Vite + vanilla JavaScript renderer and API contracts. Introduce a small dedicated public-home view, make the root state transition home → login explicit in `main.js`, then refresh presentational CSS and the SVG asset. Authentication still begins only when the visitor uses the access CTA; all current admin and seller renderers remain unchanged in behavior.

**Tech Stack:** Vite 8, vanilla JavaScript ES modules, CSS, Node test runner, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-15-universe-ti-executive-redesign.md`

## Global Constraints

- Visible brand and `alt` text are exactly `Universe TI`; no icon, slogan or external asset.
- Preserve existing APIs, authentication, permissions, calculations, payments, archive and audit flows.
- Do not add dependencies, remote fonts, external icons, images or services.
- Use canvas `#111017`, surface `#1A1722`, text `#F8F7FC`, accent `#7C3AED`, accent-light `#A78BFA`, success `#4E9F79`, danger `#C96870`.
- Keep existing pt-BR operational copy, semantic controls, keyboard focus and mobile data labels.
- Do not implement metas, ranking, profile details, commission detail or realtime notifications without data contracts.

---

## File Structure

- `public/assets/universe-ti.svg`: icon-free wordmark with precise single-system text spacing.
- `src/client/views/home-view.js`: public institutional home and an `onEnter` callback boundary; no authentication logic.
- `src/client/views/login-view.js`: current credential flow with Universe TI branding only.
- `src/client/main.js`: public state selection and handoff from home to login; session handling unchanged.
- `src/client/styles/app.css`: visual tokens, home composition and existing operating surfaces.
- `index.html`: Universe TI document title.
- `tests/unit/home-view.test.js`: isolated public-home structure and CTA behavior.
- `tests/unit/login-view.test.js`: source and accessible semantics of the new wordmark.
- `tests/unit/main.test.js`: root bootstrap state selection only if existing test helpers support it; otherwise the home callback contract is covered in `home-view.test.js`.

### Task 1: Create the Universe TI wordmark and replace asset references

**Files:**
- Create: `public/assets/universe-ti.svg`
- Modify: `index.html:7`
- Modify: `src/client/main.js:26-56`
- Modify: `src/client/views/login-view.js:19-29`
- Modify: `src/client/views/seller-view.js` (every current brand image reference)
- Modify: `tests/unit/login-view.test.js:46-65`
- Test: `tests/unit/login-view.test.js`

**Interfaces:**
- Produces static asset `/assets/universe-ti.svg` with SVG `<title>Universe TI</title>`.
- Existing image controls consume `src: '/assets/universe-ti.svg'` and `alt: 'Universe TI'`.

- [ ] **Step 1: Write failing brand assertions**

```js
assert.equal(root.children[0].children[0].children[0].children[0].getAttribute('src'), '/assets/universe-ti.svg');
assert.equal(root.children[0].children[0].children[0].children[0].getAttribute('alt'), 'Universe TI');
```

- [ ] **Step 2: Run the focused test to establish failure**

Run: `node --test tests/unit/login-view.test.js`

Expected: FAIL because the rendered source remains `/assets/galaxy-mark.svg`.

- [ ] **Step 3: Add the exact wordmark asset and replace presentation references**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 273 56" role="img" aria-labelledby="title">
  <title id="title">Universe TI</title>
  <text x="0" y="43" fill="#F8F7FC" font-family="system-ui, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif" font-size="43" font-weight="760" letter-spacing="-2.1">Universe</text>
  <text x="206" y="43" fill="#A78BFA" font-family="system-ui, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif" font-size="43" font-weight="760" letter-spacing="-1.4">TI</text>
</svg>
```

Use `/assets/universe-ti.svg` and `Universe TI` at every visible product logo and update the document title to `Universe TI | Controle de Comissões`. Verify no `Galaxy Smart` or `galaxy-mark.svg` remains in client/public/index source except deliberately retained legacy files.

- [ ] **Step 4: Run focused validation**

Run: `node --test tests/unit/login-view.test.js && node --check src/client/main.js && node --check src/client/views/login-view.js`

Expected: PASS and exit 0.

- [ ] **Step 5: Commit the brand boundary**

```bash
git add public/assets/universe-ti.svg index.html src/client/main.js src/client/views/login-view.js src/client/views/seller-view.js tests/unit/login-view.test.js
git commit -m "feat: introduce Universe TI brand"
```

### Task 2: Implement the public home and explicit access handoff

**Files:**
- Create: `src/client/views/home-view.js`
- Modify: `src/client/main.js:79-135`
- Create: `tests/unit/home-view.test.js`
- Test: `tests/unit/home-view.test.js`

**Interfaces:**
- Exports `renderHome(root, { onEnter = () => {} } = {})`.
- Returns `{ enterButton }` for isolated interaction testing.
- `onEnter` is called synchronously only by the button click; the home neither creates a session client nor calls APIs.

- [ ] **Step 1: Write the failing home contract test**

```js
import { renderHome } from '../../src/client/views/home-view.js';

test('home presents Universe TI and opens login only through its access CTA', () => {
  const document = createDocument();
  const root = document.createElement('div');
  let entered = 0;
  const view = renderHome(root, { onEnter: () => { entered += 1; } });

  assert.equal(root.children[0].getAttribute('data-public-home'), 'universe-ti');
  assert.equal(view.enterButton.textContent, 'Acessar plataforma');
  assert.equal(view.enterButton.getAttribute('type'), 'button');
  view.enterButton.dispatch('click');
  assert.equal(entered, 1);
});
```

- [ ] **Step 2: Run the test to establish failure**

Run: `node --test tests/unit/home-view.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `home-view.js`.

- [ ] **Step 3: Implement the isolated home view**

Build semantic `<main>`, `<header>`, hero `<section>`, benefit list and `<footer>`. Include exactly three existing-capability benefit titles: `Acompanhe comissões`, `Pagamentos organizados`, `Gestão de equipe`. Use a `<button type="button">Acessar plataforma</button>` bound to `onEnter`; do not create links to nonexistent routes or include invented support channels.

- [ ] **Step 4: Wire public boot state in `main.js`**

Add a local `showHome()` next to `showLogin()`, rendering `renderHome(root, { onEnter: showLogin })`. On first bootstrap with no restored session, call `showHome()` instead of `showLogin()`. Keep session-expiry and explicit sign-out paths directed to `showLogin(message)` so authenticated users receive the existing recovery message and no protected state changes.

- [ ] **Step 5: Run view tests**

Run: `node --test tests/unit/home-view.test.js tests/unit/login-view.test.js`

Expected: PASS with the CTA calling exactly once and login semantics preserved.

- [ ] **Step 6: Commit the public flow**

```bash
git add src/client/views/home-view.js src/client/main.js tests/unit/home-view.test.js
git commit -m "feat: add Universe TI public home"
```

### Task 3: Apply the executive editorial surface system

**Files:**
- Modify: `src/client/styles/app.css`
- Test: `tests/unit/admin-view.test.js`
- Test: `tests/unit/seller-view.test.js`

**Interfaces:**
- CSS-only changes consume existing classes: `.app-shell`, `.login-shell`, `.session-header`, `.admin-tabs`, `.summary-metrics`, `.data-table`, `.seller-chart`, `.form-feedback`, `.confirmation-dialog`.
- Adds home-only classes scoped under `[data-public-home='universe-ti']`; no admin/seller DOM changes required.

- [ ] **Step 1: Run existing view contracts before CSS work**

Run: `node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js`

Expected: PASS before presentational changes.

- [ ] **Step 2: Consolidate final tokens**

Place the final token layer at the end of `app.css` so it overrides legacy declarations:

```css
:root {
  --canvas: #111017;
  --canvas-deep: #0d0c12;
  --surface: #1a1722;
  --surface-raised: #231e2e;
  --text: #f8f7fc;
  --muted: #b8b1c6;
  --accent: #7c3aed;
  --accent-light: #a78bfa;
  --success: #4e9f79;
  --danger: #c96870;
}
```

Apply these variables to page canvas, surfaces, button primary/focus states, selected tabs, positive/error feedback, charts and tables. Preserve `font-variant-numeric: tabular-nums` for metrics, table values and currency values.

- [ ] **Step 3: Style the home and refine existing surfaces**

Scope home styles with `[data-public-home='universe-ti']`: use generous desktop spacing, one focused CTA, three visually even benefit cards, and a compact footer. At `max-width: 700px`, stack hero and benefit content, keep the CTA full-width and prevent horizontal overflow. Use 200–300 ms `cubic-bezier(.2,.8,.2,1)` transitions on buttons, tabs, inputs and table rows. Retain accessible focus outlines and do not use blur on scrollable content.

- [ ] **Step 4: Run view and stylesheet validation**

Run: `node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js && npm run check && git diff --check`

Expected: PASS and exit 0.

- [ ] **Step 5: Commit visual system**

```bash
git add src/client/styles/app.css
git commit -m "feat: apply Universe TI executive surfaces"
```

### Task 4: Verify navigation, responsive UI and production delivery

**Files:**
- Modify only if this task reveals a concrete defect: `src/client/styles/app.css`, `src/client/views/home-view.js`, `src/client/main.js`

**Interfaces:**
- Public production route `/` must render the home.
- CTA must render the current login form with accessible username/password fields.
- Production API path `POST /api/auth/login` must return an application-level 401 for a deliberately nonexistent credential.

- [ ] **Step 1: Run full repository verification**

Run: `npm test && npm run check && npm run build && git diff --check`

Expected: all tests pass; Vite emits `dist`; exit 0.

- [ ] **Step 2: Run visual anti-pattern detector**

Run:

```bash
node 'C:/Users/vinic/AppData/Local/hermes/skills/design/impeccable/scripts/detect.mjs' --json src/client/styles/app.css src/client/views/home-view.js src/client/views/login-view.js
```

Expected: `[]` and exit 0.

- [ ] **Step 3: Inspect published-layout behavior locally**

Start Vite in a background process, then use browser automation to measure home and login at desktop and 390 px wide. Assert `document.documentElement.scrollWidth - document.documentElement.clientWidth === 0`, CTA causes `[data-login-layout='modern']` to render, the logo source is `/assets/universe-ti.svg`, and computed `--accent` is `#7c3aed`. Capture desktop and mobile screenshots before stopping the local server.

- [ ] **Step 4: Deploy and verify production**

Run:

```bash
npx.cmd vercel --prod --yes
python - <<'PY'
from urllib.error import HTTPError
from urllib.request import Request, urlopen
base = 'https://galaxy-smart.vercel.app'
for path, method, body in [
  ('/health', 'GET', None),
  ('/assets/universe-ti.svg', 'GET', None),
  ('/api/auth/login', 'POST', b'{"identifier":"verification-nonexistent","password":"invalid-credential"}'),
]:
  request = Request(base + path, data=body, method=method, headers={'Content-Type': 'application/json'} if body else {})
  try:
    print(path, urlopen(request, timeout=30).status)
  except HTTPError as error:
    print(path, error.code)
PY
```

Expected: health 200, asset 200, login 401. The login request must not use a valid user and must not mutate production data.

- [ ] **Step 5: Commit any concrete QA repair only after re-running Step 1**

```bash
git add src/client/styles/app.css src/client/views/home-view.js src/client/main.js
git commit -m "fix: resolve Universe TI responsive QA"
```

Skip this commit if no defect was found.
