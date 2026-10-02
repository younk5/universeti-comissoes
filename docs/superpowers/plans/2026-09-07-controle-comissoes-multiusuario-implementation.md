# Controle de Comissões Multiusuário Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o Galaxy Smart como aplicação hospedável na Vercel, com Firebase Authentication, Firestore, painel administrativo e carteira isolada para cada vendedor.

**Architecture:** Um servidor Express em Node.js é capturado pela Vercel, serve o front-end Vite e expõe a API do mesmo domínio. Firebase Authentication armazena credenciais; Firestore é acessado apenas pelo Firebase Admin SDK no servidor. O navegador mantém sessão Firebase e envia token Bearer à API, que confere token, perfil, papel e estado ativo em toda requisição.

**Tech Stack:** Node.js 22, JavaScript ESM, Express, Vite vanilla, Firebase Authentication, Cloud Firestore, Firebase Admin SDK, Firebase Emulator Suite, Node test runner, Supertest e Vercel.

**Spec:** `docs/superpowers/specs/2026-09-07-controle-comissoes-multiusuario-design.md`

## Global Constraints

- Hospedar na Vercel desde a primeira versão; não usar `localStorage` como fonte de verdade.
- Usar Firebase Authentication com e-mail/senha e Cloud Firestore; não criar autenticação, hash ou banco próprios.
- O login aceita e-mail ou nome de usuário; a resolução de nome de usuário ocorre somente no servidor.
- Firestore deve negar acesso direto do navegador; dados de negócio passam pela API Node.js com Firebase Admin SDK.
- Todo endpoint autenticado valida token, perfil no Firestore, `role` e `active`.
- Somente `admin` altera vendedores e comissões; `seller` só lê a própria carteira e troca a própria senha.
- A base Firebase inicia vazia. Não importar dados, retiradas ou registros do sistema local.
- Recebimentos novos são comissões `paid`; não recriar retiradas no novo modelo.
- Senhas nunca são gravadas em Firestore, Git, logs ou respostas. Criação e redefinição exigem 12 caracteres ou mais.
- E-mail e nome de usuário são únicos sem diferenciar maiúsculas/minúsculas.
- Excluir vendedor só é permitido sem comissões; com histórico, o admin deve desativar a conta.
- Valores financeiros são positivos em BRL; datas usam `YYYY-MM-DD`; interface e erros ficam em pt-BR.
- Preservar a marca Galaxy Smart, foco visível e responsividade sem overflow a 390 px.
- Segredos ficam somente em `.env` e variáveis da Vercel; `.env.example` não contém valores reais.
- Não declarar Firebase, preview ou produção configurados sem conferir o ambiente autorizado pelo usuário.

---

## File Structure

```text
index.html                               # shell Vite
package.json                             # scripts e dependências
vite.config.js                           # proxy local /api
server.js                                # servidor local e entrada Vercel
vercel.json                              # build e arquivos do servidor
firebase.json                            # emuladores Auth/Firestore
firestore.rules                          # bloqueio de acesso direto
.env.example                             # contrato de variáveis
scripts/bootstrap-admin.js               # primeira conta admin
scripts/assert-no-secrets.js             # auditoria de arquivos rastreados
src/server/app.js                        # createApp({ services, config })
src/server/config.js                     # readConfig(env)
src/server/errors.js                     # AppError e erro JSON
src/server/firebase-admin.js             # Firebase Admin singleton
src/server/middleware/auth.js            # token, perfil ativo, admin
src/server/domain/validation.js          # schemas e normalização
src/server/domain/commissions.js         # cálculo, filtros, totais e gráfico
src/server/domain/csv.js                 # CSV UTF-8 BOM
src/server/services/auth-service.js      # login por identificador e senha
src/server/services/user-service.js      # usuários, usernames, bloqueio
src/server/services/commission-service.js# comissões, lote e carteira
src/server/routes/auth-routes.js         # /api/auth/* e /api/me
src/server/routes/user-routes.js         # /api/users/*
src/server/routes/commission-routes.js   # /api/commissions/* e /api/wallet
src/client/firebase-client.js            # sessão Firebase no navegador
src/client/api-client.js                 # fetch Bearer e erros
src/client/format.js                     # moeda, data e escape HTML
src/client/views/login-view.js           # login
src/client/views/admin-view.js           # administração
src/client/views/seller-view.js          # carteira somente leitura
src/client/main.js                       # bootstrap e roteamento de papel
src/client/styles/app.css                # tema e responsividade
public/assets/galaxy-smart.png           # logo existente

tests/unit/validation.test.js
tests/unit/commissions.test.js
tests/unit/csv.test.js
tests/api/auth.test.js
tests/api/users.test.js
tests/api/commissions.test.js
tests/integration/firebase-authz.test.js
tests/integration/firestore-rules.test.js
```

Os arquivos estáticos antigos `app.js`, `style.css` e `tests/app.test.js` são removidos no primeiro task. Nenhum código acessível pode continuar usando a chave `controle-comissoes.v1`.

---

### Task 1: Fundar o projeto Vite, Express, Vercel e Firebase local

**Files:**
- Create: `package.json`, `vite.config.js`, `server.js`, `vercel.json`, `firebase.json`, `firestore.rules`, `.env.example`
- Create: `src/server/app.js`, `src/server/config.js`, `src/server/errors.js`, `src/client/main.js`, `src/client/styles/app.css`, `scripts/assert-no-secrets.js`, `tests/api/health.test.js`
- Modify: `.gitignore`, `index.html`
- Move: `assets/galaxy-smart.png` → `public/assets/galaxy-smart.png`
- Delete: `app.js`, `style.css`, `tests/app.test.js`

**Interfaces:**
- Produces `createApp({ services, config })`, `readConfig(env)`, `AppError`, `GET /health`.
- Later tasks inject fake `services` into `createApp` and import `readConfig` before Firebase is initialized.

- [ ] **Step 1: Escrever o teste vermelho do servidor**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

test('GET /health responde sem autenticação', async () => {
  const response = await request(createApp({ services: {}, config: { nodeEnv: 'test' } }))
    .get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});
```

- [ ] **Step 2: Confirmar a falha inicial**

Run: `node --test tests/api/health.test.js`  
Expected: falha por módulo `src/server/app.js` inexistente.

- [ ] **Step 3: Implementar servidor mínimo e ferramentas**

Criar `package.json` ESM com scripts abaixo e dependências `express`, `firebase`, `firebase-admin`, `helmet`, `zod`; devDependencies `vite`, `concurrently`, `supertest`, `firebase-tools`, `@firebase/rules-unit-testing`.

```json
{
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently \"node --watch server.js\" \"vite --host 127.0.0.1\"",
    "start": "node server.js",
    "build": "vite build",
    "test": "node --test tests/unit tests/api",
    "test:emulators": "firebase emulators:exec --only auth,firestore \"node --test tests/integration\"",
    "check": "node --check server.js && node --check src/server/app.js && npm run check:secrets",
    "check:secrets": "node scripts/assert-no-secrets.js"
  }
}
```

```js
// src/server/app.js
import express from 'express';
import helmet from 'helmet';

export function createApp({ services, config }) {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  return app;
}
```

`server.js` cria `createApp`, serve `dist` quando existir e chama `listen(Number(process.env.PORT ?? 3000))`. `vite.config.js` encaminha `/api` para `http://127.0.0.1:3000`. `firestore.rules` usa `allow read, write: if false;`. `firebase.json` define Auth em `9099`, Firestore em `8080` e UI em `4000`.

Depois de registrar as rotas, `app.js` termina com middleware que converte `error.status` e `error.code` em JSON `{ message, code }`, usando status `500` e mensagem `Não foi possível concluir a operação.` apenas para erro sem status conhecido.

- [ ] **Step 4: Criar proteção de ambiente e segredos**

```js
// src/server/config.js
export function readConfig(env) {
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY', 'FIREBASE_WEB_API_KEY', 'FIREBASE_WEB_AUTH_DOMAIN', 'FIREBASE_WEB_APP_ID', 'FIREBASE_WEB_MESSAGING_SENDER_ID'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length && env.NODE_ENV !== 'test') throw new Error(`Variáveis ausentes: ${missing.join(', ')}`);
  return { nodeEnv: env.NODE_ENV ?? 'development', projectId: env.FIREBASE_PROJECT_ID ?? 'demo-galaxy-smart', webApiKey: env.FIREBASE_WEB_API_KEY ?? '' };
}
```

Fazer `.env.example` listar cada variável exigida sem valor. Fazer `scripts/assert-no-secrets.js` falhar se arquivos rastreados contiverem `BEGIN PRIVATE KEY`, `AIza` ou `FIREBASE_ADMIN_PRIVATE_KEY=` com valor não vazio. Adicionar `node_modules/`, `dist/`, `.env`, `.vercel/` a `.gitignore`.

- [ ] **Step 5: Substituir a página antiga pelo shell Galaxy Smart**

Manter no `index.html` apenas `#app`, a referência ao logo `/assets/galaxy-smart.png`, viewport e `<script type="module" src="/src/client/main.js">`. Mover o logo com `git mv` e remover arquivos estáticos que gravavam no navegador.

- [ ] **Step 6: Executar fundação e criar commit**

Run: `npm install && npm test && npm run check && npm run build && git diff --check`  
Expected: todos passam; `dist/` não aparece em `git status --short`.

```bash
git add package.json package-lock.json vite.config.js server.js vercel.json firebase.json firestore.rules .env.example .gitignore index.html public src tests scripts
git rm app.js style.css tests/app.test.js
git commit -m "feat: scaffold hosted commission platform"
```

### Task 2: Implementar contrato de domínio, Firebase Admin e autenticação

**Files:**
- Create: `src/server/firebase-admin.js`, `src/server/domain/validation.js`, `src/server/middleware/auth.js`, `src/server/services/auth-service.js`, `src/server/routes/auth-routes.js`, `scripts/bootstrap-admin.js`
- Create: `tests/unit/validation.test.js`, `tests/api/auth.test.js`
- Modify: `src/server/app.js`, `src/server/config.js`, `.env.example`, `README.md`

**Interfaces:**
- Produces `normalizeIdentifier(value)`, `parseMoney(value)`, `validatePassword(value)`, `requireActor(services)`, `requireAdmin`, `createAuthService(deps)`.
- `authService.login({ identifier, password })` retorna `{ customToken, actor }`; `authService.getActor(uid)` e `authService.verifyActor(token)` retornam `{ id, role, name, active }`.
- User and commission routes consume `req.actor` after `requireActor`.

- [ ] **Step 1: Escrever testes vermelhos de normalização e login seguro**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentifier, validatePassword } from '../../src/server/domain/validation.js';

test('normaliza nome de usuário sem alterar e-mail', () => {
  assert.equal(normalizeIdentifier('  Vendas.SP  '), 'vendas.sp');
  assert.equal(normalizeIdentifier(' ANA@EXEMPLO.COM '), 'ana@exemplo.com');
});

test('bloqueia senha inicial com menos de 12 caracteres', () => {
  assert.throws(() => validatePassword('12345678901'), /12 caracteres/);
});
```

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

test('login inválido não revela se o identificador existe', async () => {
  const services = { auth: { login: async () => { throw Object.assign(new Error('invalid'), { code: 'INVALID_LOGIN' }); } } };
  const response = await request(createApp({ services, config: { nodeEnv: 'test' } }))
    .post('/api/auth/login').send({ identifier: 'nao-existe', password: 'senha-invalida' });
  assert.equal(response.status, 401);
  assert.equal(response.body.message, 'E-mail, usuário ou senha inválidos.');
});
```

- [ ] **Step 2: Confirmar que os testes falham**

Run: `node --test tests/unit/validation.test.js tests/api/auth.test.js`  
Expected: falha por exportações e rota inexistentes.

- [ ] **Step 3: Implementar Admin SDK e login por identificador**

`firebase-admin.js` inicializa uma única aplicação com `projectId`, `clientEmail` e `privateKey.replace(/\\n/g, '\n')`. Em emulador, define `FIRESTORE_EMULATOR_HOST` e `FIREBASE_AUTH_EMULATOR_HOST` antes de obter os clientes.

```js
// src/server/domain/validation.js
export function normalizeIdentifier(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}
export function validatePassword(value) {
  if (String(value ?? '').length < 12) throw new Error('A senha deve ter pelo menos 12 caracteres.');
  return String(value);
}
```

`authService.login` normaliza o identificador, consulta `users` por e-mail quando contém `@` ou consulta `usernames/{identifier}` e depois `users/{uid}`. Ele monta `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.webApiKey}` com o e-mail resolvido e a senha; quando `FIREBASE_AUTH_EMULATOR_HOST` existir, monta `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.webApiKey}`. Depois verifica perfil ativo e retorna `auth.createCustomToken(uid)`. Qualquer falha de identificação, senha ou conta desativada vira `INVALID_LOGIN`.

- [ ] **Step 4: Implementar middleware e rotas de sessão**

```js
export function requireActor({ authService }) {
  return async (req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Sessão necessária.' });
    try { req.actor = await authService.verifyActor(token); return next(); }
    catch { return res.status(401).json({ message: 'Sessão inválida ou expirada.' }); }
  };
}
export function requireAdmin(req, res, next) {
  return req.actor.role === 'admin' ? next() : res.status(403).json({ message: 'Acesso permitido somente à administração.' });
}
```

Registrar `POST /api/auth/login`, `GET /api/me`, `POST /api/auth/logout` e `PATCH /api/me/password`. A troca de senha verifica a senha atual com Identity Toolkit, valida a nova, atualiza Firebase Auth, revoga tokens e retorna `204`; o cliente deve sair e solicitar novo login.

- [ ] **Step 5: Criar bootstrap não rastreado do primeiro administrador**

`bootstrap-admin.js` exige `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME` e `BOOTSTRAP_ADMIN_PASSWORD`, valida a senha, falha se já existir algum `users` com `role: 'admin'`, cria o usuário Firebase e grava em transação `users/{uid}` e `usernames/{usernameNormalized}`. Nunca imprimir senha ou chave privada.

- [ ] **Step 6: Verificar e criar commit**

Run: `npm test && npm run check && node scripts/bootstrap-admin.js` sem variáveis  
Expected: testes passam; bootstrap falha com lista de variáveis ausentes, sem criar usuário.

```bash
git add src/server scripts tests README.md .env.example
git commit -m "feat: add Firebase authentication foundation"
```

### Task 3: Criar administração segura de vendedores

**Files:**
- Create: `src/server/services/user-service.js`, `src/server/routes/user-routes.js`, `tests/api/users.test.js`, `tests/integration/firebase-authz.test.js`
- Modify: `src/server/app.js`, `src/server/middleware/auth.js`, `src/server/domain/validation.js`, `scripts/bootstrap-admin.js`

**Interfaces:**
- Produces `userService.createSeller(input)`, `updateSeller(id, input)`, `disableSeller(id)`, `deleteSeller(id)`, `resetSellerPassword(id, password)`, `listSellers()`.
- `createSeller` returns perfil sem senha: `{ id, name, email, username, phone, active, defaultCommissionRate }`.
- `deleteSeller` lança `SELLER_HAS_COMMISSIONS` se houver comissão ligada ao vendedor.

- [ ] **Step 1: Escrever o teste vermelho de criação e exclusão protegida**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const admin = { id: 'admin-1', role: 'admin', active: true };
const users = {
  createSeller: async ({ password: _password, ...input }) => ({ id: 'seller-1', ...input, active: true }),
  deleteSeller: async () => { const error = new Error('Possui comissões.'); error.code = 'SELLER_HAS_COMMISSIONS'; error.status = 409; throw error; }
};
const app = createApp({ services: { auth: { verifyActor: async () => admin }, users }, config: { nodeEnv: 'test' } });

test('admin cria vendedor sem devolver a senha', async () => {
  const response = await request(app).post('/api/users').set('Authorization', 'Bearer token')
    .send({ name: 'Ana', email: 'ana@exemplo.com', username: 'ana', password: 'senha-segura-123', phone: '', defaultCommissionRate: 10 });
  assert.equal(response.status, 201);
  assert.equal(response.body.username, 'ana');
  assert.equal('password' in response.body, false);
});

test('vendedor com comissão não pode ser apagado', async () => {
  const response = await request(app).delete('/api/users/seller-1').set('Authorization', 'Bearer token');
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'SELLER_HAS_COMMISSIONS');
});
```

- [ ] **Step 2: Confirmar falha e implementar transações**

Run: `node --test tests/api/users.test.js`  
Expected: falha porque a rota `/api/users` ainda não existe.

Implementar criação como: validar schema, `auth.createUser`, transação que reserva `usernames/{normalizado}` e cria `users/{uid}`. Se a transação falhar, apagar o usuário Auth recém-criado. Em edição de username, remover índice antigo e criar índice novo na mesma transação. Não permitir alterar `role` por payload.

- [ ] **Step 3: Implementar rotas administrativas e bloqueio de sessão**

```js
router.post('/api/users', requireActor(services), requireAdmin, async (req, res, next) => {
  try { res.status(201).json(await services.users.createSeller(req.body)); }
  catch (error) { next(error); }
});
```

Adicionar `GET /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/disable`, `POST /api/users/:id/enable`, `POST /api/users/:id/reset-password` e `DELETE /api/users/:id`. Desativação atualiza perfil, chama `auth.updateUser(id, { disabled: true })` e `auth.revokeRefreshTokens(id)`. Rotas de vendedor retornam `403` antes de invocar serviço.

- [ ] **Step 4: Cobrir emulador e commit**

No teste de integração, criar admin e seller no Auth Emulator, validar que seller recebe `403` em `POST /api/users`, que disable impede `verifyActor`, e que `firestore.rules` rejeita leitura direta de cliente autenticado.

Run: `npm test && npm run test:emulators && npm run check`  
Expected: suíte local e emulador passam.

```bash
git add src/server tests scripts
git commit -m "feat: add secure seller administration"
```

### Task 4: Implementar comissões, status, carteira e CSV

**Files:**
- Create: `src/server/domain/commissions.js`, `src/server/domain/csv.js`, `src/server/services/commission-service.js`, `src/server/routes/commission-routes.js`
- Create: `tests/unit/commissions.test.js`, `tests/unit/csv.test.js`, `tests/api/commissions.test.js`
- Modify: `src/server/app.js`, `src/server/domain/validation.js`

**Interfaces:**
- Produces `calculateCommission(input)`, `filterCommissions(items, filter)`, `summarizeCommissions(items)`, `buildMonthlyPaidSeries(items)`, `buildCsv(rows)`.
- `commissionService.create(actor, input)`, `update(id, input)`, `delete(id)`, `markPaid(ids)`, `list(actor, filter)`, `wallet(actor, filter)`.
- `wallet` returns `{ pendingTotal, paidTotal, commissions, monthlyPaid }`.

- [ ] **Step 1: Escrever testes vermelhos de cálculo, lote e isolamento**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommission, summarizeCommissions } from '../../src/server/domain/commissions.js';

test('calcula comissão percentual e conserva valor calculado', () => {
  assert.equal(calculateCommission({ saleValue: 1200, commissionType: 'percentage', commissionInput: 10 }), 120);
});

test('separa totais pendente e pago', () => {
  assert.deepEqual(summarizeCommissions([{ commissionValue: 100, paymentStatus: 'pending' }, { commissionValue: 70, paymentStatus: 'paid' }]), { pendingTotal: 100, paidTotal: 70 });
});
```

```js
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const seller = { id: 'seller-a', role: 'seller', active: true };
const app = createApp({
  services: {
    auth: { verifyActor: async () => seller },
    commissions: { list: async (actor) => ({ items: [{ id: 'c-1', sellerId: actor.id }] }) }
  },
  config: { nodeEnv: 'test' }
});

test('vendedor só recebe as próprias comissões', async () => {
  const response = await request(app).get('/api/commissions?sellerId=seller-b').set('Authorization', 'Bearer token');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.items.map((item) => item.sellerId), ['seller-a']);
});
```

- [ ] **Step 2: Confirmar falha e implementar domínio puro**

Run: `node --test tests/unit/commissions.test.js tests/unit/csv.test.js`  
Expected: falha por módulos inexistentes.

Implementar `paymentStatus` estritamente como `pending` ou `paid`; para percentual, `commissionValue = saleValue * commissionInput / 100`; para valor fixo, `commissionValue = commissionInput`. `markPaid(ids)` remove IDs duplicados, só muda itens pendentes e grava `paidAt` para os alterados. CSV inclui BOM, cabeçalhos `Vendedor,Produto,Valor da venda,Comissão,Data,Status,Observação` e escapa aspas duplicando `"`.

- [ ] **Step 3: Implementar rotas e regras de acesso**

Criar `POST /api/commissions`, `GET /api/commissions`, `PATCH /api/commissions/:id`, `DELETE /api/commissions/:id`, `POST /api/commissions/mark-paid`, `GET /api/commissions/export.csv` para admin. Criar `GET /api/wallet` para qualquer sessão; o serviço ignora `sellerId` em query quando `actor.role === 'seller'`.

```js
const sellerId = actor.role === 'seller' ? actor.id : filter.sellerId;
if (!sellerId && actor.role === 'seller') throw new Error('Vendedor sem perfil.');
```

Ações de comissão respondem `400` para dados inválidos, `404` para ID ausente e `403` para vendedor. CSV retorna `Content-Type: text/csv; charset=utf-8` e `Content-Disposition: attachment; filename="comissoes.csv"`.

- [ ] **Step 4: Executar testes e criar commit**

Run: `npm test && npm run test:emulators && npm run check`  
Expected: percentuais, fixos, filtros por data/status/vendedor, lote, CSV e isolamento passam.

```bash
git add src/server tests
git commit -m "feat: add commissions wallets and exports"
```

### Task 5: Criar sessão do navegador e tela de login

**Files:**
- Create: `src/client/firebase-client.js`, `src/client/api-client.js`, `src/client/format.js`, `src/client/views/login-view.js`
- Modify: `src/client/main.js`, `src/client/styles/app.css`, `index.html`, `src/server/app.js`

**Interfaces:**
- `initializeFirebase(config)`, `signInWithServerToken(customToken)`, `currentIdToken()`.
- `apiClient.request(path, options)` adiciona Bearer token e converte JSON `{ message }` em `Error`.
- `renderLogin(root, { onLogin })` não conhece dados de administração nem carteira.

- [ ] **Step 1: Escrever teste de rota para configuração pública e login**

```js
test('configuração pública não contém credencial administrativa', async () => {
  const response = await request(app).get('/api/public-config');
  assert.equal(response.status, 200);
  assert.equal('privateKey' in response.body.firebase, false);
  assert.equal(typeof response.body.firebase.apiKey, 'string');
});
```

- [ ] **Step 2: Confirmar a falha e expor somente config web**

Run: `node --test tests/api/auth.test.js`  
Expected: falha por rota inexistente.

Adicionar `GET /api/public-config` com `apiKey`, `authDomain`, `projectId`, `appId` e `messagingSenderId`, todos de variáveis `FIREBASE_WEB_*`. Nunca retornar `FIREBASE_ADMIN_PRIVATE_KEY` nem client email.

- [ ] **Step 3: Implementar o fluxo visual de login**

`login-view.js` renderiza logo, input `identifier`, input `password`, botão “Entrar” e região `aria-live`. Ao enviar: chamar `POST /api/auth/login`, receber `{ customToken }`, executar `signInWithCustomToken`, consultar `GET /api/me` e escolher a view pelo papel. Em erro, apagar apenas a senha e mostrar exatamente `E-mail, usuário ou senha inválidos.`.

- [ ] **Step 4: Implementar saída, expiração e layout base**

`api-client` lê token com `getIdToken()` a cada chamada. Se a API retornar `401`, executa `signOut`, remove conteúdo protegido e volta ao login. Adicionar botão “Sair” depois de cada view autenticada. Configurar CSP no Helmet para permitir somente próprio domínio, Firebase Auth e endpoints Google necessários à sessão.

- [ ] **Step 5: Verificar e criar commit**

Run: `npm test && npm run build && npm run check`  
Expected: cliente compila e nenhuma chave administrativa aparece em `dist/`.

```bash
git add index.html src/client src/server tests
npm run check:secrets
git commit -m "feat: add authenticated client session"
```

### Task 6: Entregar painel administrativo responsivo

**Files:**
- Create: `src/client/views/admin-view.js`
- Modify: `src/client/format.js`, `src/client/main.js`, `src/client/styles/app.css`
- Modify: `tests/api/users.test.js`, `tests/api/commissions.test.js`

**Interfaces:**
- `renderAdmin(root, { api, actor, onSignOut })` carrega vendedores e comissões através da API.
- A view envia `createSeller`, `updateSeller`, `disableSeller`, `resetSellerPassword`, `createCommission`, `updateCommission`, `deleteCommission`, `markPaid` e `export.csv` apenas aos endpoints definidos nos Tasks 3–4.

- [ ] **Step 1: Escrever testes API para as interações que a tela precisa**

```js
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const app = createApp({
  services: {
    auth: { verifyActor: async () => ({ id: 'admin-1', role: 'admin', active: true }) },
    commissions: { markPaid: async (ids) => ({ updatedCount: ids.filter((id) => id === 'pending-1').length }) }
  },
  config: { nodeEnv: 'test' }
});

test('marcação em lote ignora comissão já paga', async () => {
  const response = await request(app).post('/api/commissions/mark-paid')
    .set('Authorization', 'Bearer token').send({ ids: ['pending-1', 'paid-2'] });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { updatedCount: 1 });
});
```

- [ ] **Step 2: Implementar blocos de administração**

Renderizar abas reais **Resumo**, **Vendedores** e **Comissões**. Resumo mostra pendente, pago e totais por vendedor. Vendedores possui formulário com nome, e-mail, usuário, senha inicial, telefone e percentual padrão; edição mantém senha se vazia. Comissões possui formulário, prévia do valor, filtros por vendedor/data/status, tabela, seleção e ação “Marcar selecionadas como pagas”.

- [ ] **Step 3: Implementar segurança de ações destrutivas**

Usar confirmação nativa antes de excluir comissão, excluir vendedor sem histórico e desativar vendedor. Em tentativa de excluir vendedor com comissão, exibir a mensagem retornada pela API e oferecer botão de desativação; não apagar histórico em cascata. Nunca guardar senha em objeto global, HTML persistente ou console.

- [ ] **Step 4: Implementar CSV e estados vazios**

O botão de CSV monta a mesma query dos filtros ativos, usa `fetch` autenticado, cria um `Blob` e baixa `comissoes.csv`. Todas as tabelas mostram estado vazio em pt-BR, carregamento desabilita botão de submissão e erros aparecem perto do formulário que falhou.

- [ ] **Step 5: Verificar e criar commit**

Run: `npm test && npm run build && npm run check`  
Expected: endpoints suportam todos os comandos exibidos; build passa.

```bash
git add src/client tests
git commit -m "feat: add admin commission dashboard"
```

### Task 7: Entregar carteira restrita do vendedor e QA visual local

**Files:**
- Create: `src/client/views/seller-view.js`
- Modify: `src/client/main.js`, `src/client/styles/app.css`, `tests/api/commissions.test.js`

**Interfaces:**
- `renderSeller(root, { api, actor, onSignOut })` chama somente `GET /api/wallet` e `PATCH /api/me/password`.
- Resposta da carteira mantém `{ pendingTotal, paidTotal, commissions, monthlyPaid }` do Task 4.

- [ ] **Step 1: Escrever teste de isolamento completo**

```js
import request from 'supertest';
import { createApp } from '../../src/server/app.js';

const app = createApp({
  services: {
    auth: { verifyActor: async () => ({ id: 'seller-a', role: 'seller', active: true }) },
    commissions: { wallet: async (actor) => ({ pendingTotal: 100, paidTotal: 0, commissions: [{ sellerId: actor.id }], monthlyPaid: [] }) }
  },
  config: { nodeEnv: 'test' }
});

test('seller não consegue forçar sellerId de outro vendedor na carteira', async () => {
  const response = await request(app).get('/api/wallet?sellerId=seller-b').set('Authorization', 'Bearer token');
  assert.equal(response.status, 200);
  assert.equal(response.body.commissions.every((item) => item.sellerId === 'seller-a'), true);
});
```

- [ ] **Step 2: Implementar carteira somente leitura**

Mostrar nome do vendedor, cartões “A receber” e “Já recebido”, filtro de período, gráfico de barras mensal usando HTML/CSS sem biblioteca externa e extrato com produto, venda, comissão, data e status. Não renderizar formulários de vendedores, comissões, exclusões, alteração de status ou CSV administrativo.

- [ ] **Step 3: Implementar troca da própria senha**

Adicionar formulário com senha atual, nova senha e confirmação. Exigir que nova senha e confirmação coincidam antes de chamar API. Após resposta `204`, sair da sessão e mostrar `Senha alterada. Entre novamente com a nova senha.`.

- [ ] **Step 4: Fazer QA no navegador contra emuladores**

Iniciar `firebase emulators:start --only auth,firestore` e `npm run dev`. Criar um admin e dois vendedores pelo bootstrap/teste. Verificar manualmente login por e-mail e usuário, isolamento entre vendedores, filtros, gráfico, troca de senha, viewports desktop e 390 px e ausência de overflow horizontal. Registrar capturas e erros de console no relatório de entrega.

- [ ] **Step 5: Rodar verificações e criar commit**

Run: `npm test && npm run test:emulators && npm run build && npm run check && git diff --check`  
Expected: todas as verificações passam.

```bash
git add src/client src/server tests
git commit -m "feat: add seller wallet portal"
```

### Task 8: Documentar, preparar Firebase/Vercel e verificar implantação autorizada

**Files:**
- Modify: `README.md`, `docs/PRD.md`, `.env.example`, `vercel.json`, `scripts/assert-no-secrets.js`
- Create: `docs/DEPLOYMENT.md`

**Interfaces:**
- Produces documentação reproduzível para Firebase, bootstrap e Vercel; nenhum segredo ou conta de produção é versionado.

- [ ] **Step 1: Atualizar documentação para o novo produto**

Substituir instruções de duplo clique/localStorage por: Node 22, `npm install`, `.env`, Firebase Emulator, `npm run dev`, testes, bootstrap e build. Atualizar PRD para perfis, Firestore, status `pending`/`paid`, base vazia e exclusão por desativação. Documentar explicitamente que dados antigos não são migrados.

- [ ] **Step 2: Escrever o guia de produção com ações verificáveis**

`docs/DEPLOYMENT.md` deve listar, nesta ordem: criar projeto Firebase; ativar Authentication por e-mail/senha; criar Firestore; obter Web API key/config; criar credencial de serviço; cadastrar variáveis `FIREBASE_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `FIREBASE_WEB_API_KEY` e `FIREBASE_WEB_*` na Vercel; publicar; executar bootstrap com ambiente local seguro; testar login admin e vendedor. Declarar que criação de conta Firebase/Vercel exige sessão autorizada do usuário.

- [ ] **Step 3: Configurar e testar contrato de deploy**

Configurar `vercel.json` para executar `npm run build`, incluir `dist/**` na função `server.js` e aplicar cabeçalhos de segurança. Validar localmente com `npm run build && npm start`, abrir `/health` e a página inicial. Não publicar enquanto o usuário não autorizar acesso a uma sessão Vercel/Firebase.

- [ ] **Step 4: Executar portões finais e revisar arquivos rastreados**

Run: `npm test && npm run test:emulators && npm run build && npm run check && git diff --check && git status --short`  
Expected: testes, emuladores, build, sintaxe e auditoria de segredos passam; `.env`, `dist`, `node_modules` e `.vercel` não aparecem.

- [ ] **Step 5: Criar commit de documentação e preparação**

```bash
git add README.md docs/PRD.md docs/DEPLOYMENT.md .env.example vercel.json scripts
npm run check:secrets
git commit -m "docs: prepare Firebase and Vercel deployment"
```

## Plan Coverage Review

| Requisito da especificação | Task |
|---|---|
| Vercel, Node 22, Vite e headers | 1, 5, 8 |
| Firebase Auth, senha protegida e login por identificador | 2, 5 |
| Usuários admin/seller, nome de usuário e bloqueio | 3 |
| Comissões, filtros, status, lote, totais e CSV | 4, 6 |
| Carteira isolada e troca da própria senha | 4, 7 |
| Bloqueio de acesso direto ao Firestore | 1, 3 |
| Base nova sem migração | 1, 8 |
| Desktop, mobile e identidade Galaxy Smart | 5, 6, 7 |
| Emuladores, API, navegador e segurança | 1–8 |
| Bootstrap e documentação de produção | 2, 8 |

## Self-Review

- **Cobertura:** Cada requisito da especificação possui task e verificação identificáveis na tabela acima.
- **Consistência:** A API usa `req.actor`, fornecido pelo middleware do Task 2, em todas as rotas dos Tasks 3–4; a carteira usa o contrato produzido no Task 4 e consumido no Task 7.
- **Escopo:** Não há importação de dados locais, retirada nova, cadastro público, recuperação por e-mail ou pagamento automático.
- **Segredos:** O plano exige caminhos separados para variáveis privadas, regras Firestore deny-all e auditoria de arquivos rastreados.
