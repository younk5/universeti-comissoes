# Migração Segura para Supabase — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir Firebase por Supabase Auth + PostgreSQL sem acesso direto do navegador ao banco, mantendo os fluxos admin/seller e adicionando consistência financeira e auditoria de pagamentos.

**Architecture:** O Express na Vercel continua a ser a única API do navegador. Ele usa Supabase Auth para senha e refresh, guarda refresh token em cookie HTTP-only e usa o cliente `service_role` somente após autenticar e recarregar o perfil. Uma migration PostgreSQL cria o modelo financeiro em centavos/pontos-base, RLS deny-all, grants restritos e a transação de pagamento idempotente.

**Tech Stack:** Node.js 22+, Express 5, Vite 8, Zod 4, `@supabase/supabase-js`, Supabase CLI, PostgreSQL/Supabase, Vercel CLI, Node test runner e Supertest.

**Spec:** `docs/superpowers/specs/2026-09-08-supabase-security-migration-design.md`

## Global Constraints

- Trabalhar exclusivamente em `feat/supabase-platform`; `feat/multiuser-platform` e `feat/data-safety` não são alteradas nem integradas.
- Banco Supabase vazio em `sa-east-1`; não importar `localStorage`, Firebase, retiradas ou comissões legadas.
- O navegador chama apenas a origem da aplicação; não incluir URL, chave, SDK ou Data API Supabase no bundle Vite.
- `SUPABASE_SERVICE_ROLE_KEY`, refresh tokens, senhas, JWTs, connection strings, dumps e logs não entram em Git, respostas, erros ou saída de ferramentas.
- Toda tabela pública recebe RLS habilitado e forçado, sem policy permissiva para `anon`/`authenticated`; a API valida token, papel e perfil ativo antes de usar `service_role`.
- `admin` administra todos os sellers; `seller` acessa exclusivamente sua carteira, extrato, CSV e comissões.
- Valores são inteiros em centavos; taxas são pontos-base; nenhuma lógica financeira usa `Number` decimal como fonte de verdade.
- Exclusão de seller é desativação. Comissão paga não é apagada; anulação preserva evento de auditoria.
- Implementar em ciclos estritos RED → GREEN → REFACTOR; executar o teste específico vermelho antes do código e verde depois dele.
- Antes de qualquer commit, rodar os testes do escopo, `npm run check:secrets` e `git diff --check`; antes da entrega, rodar a suíte, build, check e validações cloud especificadas.
- Em login, senha, 2FA, consentimento ou pagamento de serviço externo, parar nessa barreira e solicitar a interação do titular; nunca adivinhar, exibir ou digitar credenciais.

---

## Estrutura de arquivos alvo

| Caminho | Papel após a migração |
|---|---|
| `package.json` | dependências Supabase e scripts sem Firebase/emuladores |
| `src/server/config.js` | validação fail-closed das variáveis Supabase e cookies |
| `src/server/supabase-admin.js` | clientes Auth e `service_role` server-side sem persistência local |
| `src/server/services/session-service.js` | login por e-mail/username, refresh, logout e mudança de senha |
| `src/server/middleware/auth.js` | Bearer, `getUser`, `iat`, perfil ativo e RBAC |
| `src/server/services/user-service.js` | vendedores, desativação, reset e compensação Auth/perfil |
| `src/server/services/commission-service.js` | consultas com escopo, CSV, centavos e RPC de pagamento |
| `src/server/domain/validation.js` | normalização, senha, moeda em centavos e taxas em pontos-base |
| `src/server/domain/commissions.js` | cálculo/serialização exata para o formato da interface |
| `src/server/routes/*.js` | rotas de sessão, usuários e comissões sem Firebase |
| `src/server/app.js` | CSP same-origin, cookies de sessão e routers Supabase |
| `src/server/vercel-app.js` | composição de serviços Supabase em produção e doubles em teste |
| `src/client/session-client.js` | access token apenas em memória e refresh deduplicado |
| `src/client/api-client.js` | Bearer, retry único após refresh e CSV protegido |
| `src/client/main.js` | restore de sessão same-origin e montagem por papel |
| `src/client/views/admin-view.js` | cópia/ação de anular comissão e senha temporária exibida uma vez |
| `supabase/config.toml` | configuração local da CLI, sem segredo |
| `supabase/migrations/202609080001_secure_galaxy_smart.sql` | tipos, schema, RLS, grants, constraints e RPC de pagamento |
| `scripts/bootstrap-admin.js` | bootstrap compensável do único admin inicial |
| `scripts/cloud-smoke.js` | smoke remoto guardado, somente em banco vazio |
| `.env.example`, `README.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md` | contrato de configuração, deploy e recuperação |
| `tests/unit/*.test.js`, `tests/api/*.test.js` | contratos de segurança, serviços, cliente, migration e UI |

Os arquivos Firebase (`src/server/firebase-admin.js`, `src/client/firebase-client.js`, `firebase.json`, `firestore.rules`, `scripts/run-emulator-tests.js`, `tests/support/firebase-test-project.js`, testes Firebase e dependências Firebase) serão removidos apenas no task que já tiver substitutos testados.

---

### Task 1: Trocar o contrato de configuração e o cliente server-side

**Files:**
- Create: `src/server/supabase-admin.js`
- Create: `tests/unit/supabase-admin.test.js`
- Modify: `src/server/config.js`
- Modify: `src/server/vercel-app.js`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `tests/unit/config.test.js`
- Delete: `src/server/firebase-admin.js`
- Delete: `tests/unit/firebase-admin.test.js`
- Delete: `tests/unit/firebase-config.test.js`

**Interfaces:**
- Produces `readConfig(env): RuntimeConfig`, que exige `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` fora de `NODE_ENV=test`.
- Produces `createServerServices(config, { createClient })`, retornando `{ authClient, adminClient }` com `persistSession: false`, `autoRefreshToken: false` e `detectSessionInUrl: false`.
- `RuntimeConfig` contém `nodeEnv`, `supabaseUrl`, `supabasePublishableKey`, `supabaseServiceRoleKey`, `sessionCookieName` e `secureCookies`.

- [ ] **Step 1: Escrever os testes vermelhos de configuração e clientes**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../../src/server/config.js';
import { createServerServices } from '../../src/server/supabase-admin.js';

test('readConfig rejects production Firebase variables and missing Supabase variables', () => {
  assert.throws(
    () => readConfig({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'legacy' }),
    /SUPABASE_URL|Firebase/i,
  );
});

test('createServerServices never persists a server session', () => {
  const calls = [];
  const createClient = (...args) => { calls.push(args); return { auth: {} }; };
  createServerServices({
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'publishable',
    supabaseServiceRoleKey: 'service',
  }, { createClient });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][2].auth, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
});
```

- [ ] **Step 2: Executar os testes para confirmar RED**

Run: `node --test tests/unit/config.test.js tests/unit/supabase-admin.test.js`  
Expected: FAIL porque o módulo Supabase e o novo contrato ainda não existem.

- [ ] **Step 3: Implementar o contrato mínimo fail-closed**

```js
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SUPABASE_URL: z.string().url().regex(/^https:\/\/[a-z0-9-]+\.supabase\.co$/),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function readConfig(env) {
  if (Object.keys(env).some((name) => name.startsWith('FIREBASE_'))) {
    throw new Error('Variáveis Firebase não são aceitas.');
  }
  const input = schema.parse(env);
  return {
    nodeEnv: input.NODE_ENV,
    supabaseUrl: input.SUPABASE_URL,
    supabasePublishableKey: input.SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: input.SUPABASE_SERVICE_ROLE_KEY,
    sessionCookieName: input.NODE_ENV === 'production' ? '__Host-galaxy-smart-refresh' : 'galaxy-smart-refresh',
    secureCookies: input.NODE_ENV === 'production',
  };
}
```

Instantiate the publishable-key Auth client and service-role client in `supabase-admin.js`; install `@supabase/supabase-js`; remove Firebase packages and replace `createServerServices` import in `vercel-app.js`. Update `npm run check` to name only the new server file paths.

- [ ] **Step 4: Executar GREEN e os guardrails**

Run: `node --test tests/unit/config.test.js tests/unit/supabase-admin.test.js && npm run check:secrets && git diff --check`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example src/server/config.js src/server/supabase-admin.js src/server/vercel-app.js tests/unit/config.test.js tests/unit/supabase-admin.test.js
git rm src/server/firebase-admin.js tests/unit/firebase-admin.test.js tests/unit/firebase-config.test.js
git commit -m "feat: add Supabase server configuration"
```

### Task 2: Criar a migration de integridade e autorização PostgreSQL

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202609080001_secure_galaxy_smart.sql`
- Create: `tests/unit/supabase-migration.test.js`
- Delete: `firebase.json`
- Delete: `firestore.rules`
- Delete: `tests/unit/firebase-emulator-project.test.js`
- Delete: `tests/support/firebase-test-project.js`

**Interfaces:**
- Produces enums `app_role`, `commission_type`, `commission_status`, `payment_event_type`.
- Produces tables `profiles`, `commissions`, `payment_batches`, `commission_payment_events`, `bootstrap_locks`.
- Produces `public.mark_commissions_paid(p_commission_ids uuid[], p_actor_id uuid)` returning rows `{ commission_id uuid, paid_at timestamptz, payment_batch_id uuid }`.

- [ ] **Step 1: Escrever o teste de contrato SQL vermelho**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('migration makes finance tables private and payment idempotent', async () => {
  const sql = await readFile('supabase/migrations/202609080001_secure_galaxy_smart.sql', 'utf8');
  for (const table of ['profiles', 'commissions', 'payment_batches', 'commission_payment_events', 'bootstrap_locks']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /CREATE FUNCTION public\.mark_commissions_paid/);
  assert.match(sql, /WHERE c\.status = 'pending'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mark_commissions_paid.* TO service_role/s);
});
```

- [ ] **Step 2: Executar o teste para confirmar RED**

Run: `node --test tests/unit/supabase-migration.test.js`  
Expected: FAIL por ausência da migration.

- [ ] **Step 3: Escrever a migration SQL completa**

A migration deve, nesta ordem:

```sql
create type public.app_role as enum ('admin', 'seller');
create type public.commission_type as enum ('percentage', 'fixed');
create type public.commission_status as enum ('pending', 'paid', 'voided');
create type public.payment_event_type as enum ('paid', 'voided');
```

Criar `profiles` com `username_normalized text not null unique`, `role public.app_role not null`, `active boolean not null default true`, `session_not_before timestamptz not null default 'epoch'`, timestamps e FK para `auth.users(id)` com `ON DELETE RESTRICT`. Criar índice parcial único `profiles_one_admin_idx` para `role = 'admin'`.

Criar `commissions` com entradas `sale_value_cents`, `commission_rate_bps`, `commission_fixed_cents`; usar `commission_value_cents bigint generated always as (...) stored`, constraints exclusivas por tipo, status e `paid_at`. Criar índices `(seller_id, created_at desc)` e `(status, created_at desc)`.

Criar `payment_batches` e `commission_payment_events` com FKs restritas e índice único em `(commission_id, event_type)` para o evento `paid`. Criar `bootstrap_locks(scope text primary key, owner_token uuid, lease_expires_at timestamptz not null)`.

A função `mark_commissions_paid` deve definir `security definer set search_path = public`, validar que o vetor não é vazio, usar CTE `updated` para atualizar somente pendentes, retornar zero linhas sem criar lote quando nada for atualizado e inserir lote/eventos dentro da mesma execução. Revogar `PUBLIC`, `anon` e `authenticated`; conceder somente `service_role`. Habilitar e forçar RLS em cada tabela sem criar policy permissiva.

- [ ] **Step 4: Executar GREEN e verificar que Firebase não permanece no contrato de banco**

Run: `node --test tests/unit/supabase-migration.test.js && npm run check:secrets && git diff --check`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/migrations/202609080001_secure_galaxy_smart.sql tests/unit/supabase-migration.test.js
git rm firebase.json firestore.rules tests/unit/firebase-emulator-project.test.js tests/support/firebase-test-project.js
git commit -m "feat: add secure Supabase database schema"
```

### Task 3: Converter domínio financeiro para centavos e pontos-base

**Files:**
- Modify: `src/server/domain/validation.js`
- Modify: `src/server/domain/commissions.js`
- Modify: `tests/unit/validation.test.js`
- Modify: `tests/unit/commissions.test.js`

**Interfaces:**
- Produces `parseMoneyToCents(value): number`, limitado a `1..900000000000000` centavos.
- Produces `parsePercentageToBasisPoints(value): number`, limitado a `1..10000` pontos-base.
- Produces `calculateCommissionCents({ saleValueCents, commissionType, commissionRateBps, commissionFixedCents }): number`.
- Produces `serializeCommission(row)` que devolve o formato já consumido pelas views: `saleValue`, `commissionInput`, `commissionValue` em reais para exibição, sem expor campos internos de banco.

- [ ] **Step 1: Escrever testes vermelhos de precisão**

```js
test('parseMoneyToCents keeps Brazilian cents exactly', () => {
  assert.equal(parseMoneyToCents('1.234,56'), 123456);
  assert.equal(parseMoneyToCents(0.01), 1);
  assert.throws(() => parseMoneyToCents('0'), /maior que zero/i);
});

test('percentage calculation rounds only at the final cent', () => {
  assert.equal(calculateCommissionCents({
    saleValueCents: 999,
    commissionType: 'percentage',
    commissionRateBps: 1050,
    commissionFixedCents: null,
  }), 105);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test tests/unit/validation.test.js tests/unit/commissions.test.js`  
Expected: FAIL porque as funções ainda usam reais com ponto flutuante.

- [ ] **Step 3: Implementar o mínimo exato**

Usar conversão textual decimal para centavos, não `Math.round(Number(value) * 100)` como fonte de verdade. Para entradas numéricas, converter primeiro para string decimal normalizada e rejeitar mais de duas casas de moeda ou mais de duas casas percentuais. Para percentual positivo, calcular:

```js
const numerator = saleValueCents * commissionRateBps;
return Math.floor((numerator + 5000) / 10000);
```

Manter a interface HTTP existente convertendo apenas no serializador de saída. Rejeitar comissão paga/voided em alterações de entrada.

- [ ] **Step 4: Confirmar GREEN e regressões do domínio**

Run: `node --test tests/unit/validation.test.js tests/unit/commissions.test.js && npm run check`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/validation.js src/server/domain/commissions.js tests/unit/validation.test.js tests/unit/commissions.test.js
git commit -m "feat: store commission amounts as integer cents"
```

### Task 4: Implementar sessão Supabase, cookies e middleware de ator

**Files:**
- Create: `src/server/services/session-service.js`
- Modify: `src/server/middleware/auth.js`
- Modify: `src/server/routes/auth-routes.js`
- Modify: `src/server/app.js`
- Modify: `src/server/errors.js`
- Modify: `tests/api/auth.test.js`
- Create: `tests/unit/session-service.test.js`
- Delete: `src/server/services/auth-service.js`
- Delete: `tests/integration/firebase-authz.test.js`

**Interfaces:**
- Produces `createSessionService({ authClient, adminClient, now }): { login, refresh, logout, changePassword }`.
- `login({ identifier, password })` devolve `{ session, actor }`; o router nunca serializa `session.refresh_token`.
- Produces `authenticateRequest({ token }): actor`, onde `actor = { id, role, name, username, active }` e JWT antigo recebe `UnauthorizedError`.
- Routers usam `setRefreshCookie(res, refreshToken, config)` e `clearRefreshCookie(res, config)`.

- [ ] **Step 1: Escrever os testes vermelhos de sessão e cookie**

```js
test('login stores only the refresh token in an HttpOnly same-site cookie', async () => {
  const app = createApp({ config: productionConfig, services: fakeServices });
  const response = await request(app).post('/api/auth/login')
    .send({ identifier: 'seller', password: 'SenhaSegura123!' });
  assert.equal(response.status, 200);
  assert.equal(response.body.refreshToken, undefined);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  assert.match(response.headers['set-cookie'][0], /Secure/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('middleware rejects a verified token issued before session_not_before', async () => {
  await assert.rejects(
    () => authenticateRequest({ token: tokenIssuedAt(100), now: () => new Date(200_000) }),
    /sessão expirada/i,
  );
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test tests/api/auth.test.js tests/unit/session-service.test.js`  
Expected: FAIL por ausência de sessão Supabase e cookies.

- [ ] **Step 3: Implementar rotas e validação**

Criar cliente de Auth com a chave publicável somente no servidor. `login` resolve username por `profiles.username_normalized`, executa `auth.signInWithPassword`, usa `auth.getUser(access_token)` e recarrega o perfil ativo por `id`. `refresh` chama `auth.refreshSession({ refresh_token })` e repete a mesma verificação de perfil. `logout` tenta `auth.signOut` quando token disponível e sempre limpa cookie.

No middleware, extrair apenas `Bearer `, chamar `auth.getUser(token)`, decodificar payload somente depois da verificação e rejeitar `iat` menor que `profiles.session_not_before`. Nunca confiar em `role` do JWT. Alterar CSP para `connectSrc: ["'self'"]`, remover `/api/public-config` e aplicar `Cache-Control: no-store` às rotas de sessão.

- [ ] **Step 4: Confirmar GREEN e garantir CSP same-origin**

Run: `node --test tests/api/auth.test.js tests/unit/session-service.test.js tests/unit/errors.test.js && npm run check:secrets && git diff --check`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/session-service.js src/server/middleware/auth.js src/server/routes/auth-routes.js src/server/app.js src/server/errors.js tests/api/auth.test.js tests/unit/session-service.test.js
git rm src/server/services/auth-service.js tests/integration/firebase-authz.test.js
git commit -m "feat: add server-mediated Supabase sessions"
```

### Task 5: Migrar administração de sellers e bootstrap do admin

**Files:**
- Modify: `src/server/services/user-service.js`
- Modify: `src/server/routes/user-routes.js`
- Modify: `scripts/bootstrap-admin.js`
- Modify: `tests/api/users.test.js`
- Modify: `tests/unit/user-service.test.js`
- Modify: `tests/unit/bootstrap-admin.test.js`

**Interfaces:**
- Produces `createUserService({ adminClient, now, createTemporaryPassword })`.
- `createSeller(input, actor)` cria Auth com `email_confirm: true`, depois perfil `seller`; se o perfil falhar, chama `auth.admin.deleteUser(id)` antes de relançar o erro.
- `setSellerActive(id, active, actor)` atualiza `profiles.active`, `session_not_before` e banimento Auth.
- `resetSellerPassword(id, actor)` devolve `{ temporaryPassword }` apenas ao router admin; nenhuma outra consulta inclui esse campo.
- `bootstrapAdmin(...)` adquire/rejeita lease em `bootstrap_locks` e impede segundo admin.

- [ ] **Step 1: Escrever testes vermelhos de compensação e senha única**

```js
test('createSeller deletes Auth identity when profile insertion fails', async () => {
  const deleted = [];
  const service = createUserService({
    adminClient: fakeAdmin({ insertProfileError: new Error('db down'), deleted }),
  });
  await assert.rejects(() => service.createSeller(validSeller, adminActor), /db down/);
  assert.deepEqual(deleted, ['seller-auth-id']);
});

test('resetSellerPassword returns temporary password once and never stores it in profile', async () => {
  const result = await service.resetSellerPassword('seller-id', adminActor);
  assert.match(result.temporaryPassword, /[A-Za-z0-9]/);
  assert.equal(fakeAdmin.profileUpdates.some((row) => 'temporaryPassword' in row), false);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test tests/api/users.test.js tests/unit/user-service.test.js tests/unit/bootstrap-admin.test.js`  
Expected: FAIL porque os doubles e o serviço ainda dependem de Firebase.

- [ ] **Step 3: Implementar administração Supabase**

Mapear linhas snake_case para o contrato camelCase existente. Validar username normalizado, e-mail e telefone antes de criar. Criar usuário pelo método administrativo Supabase, inserir perfil explícito, compensar a identidade na falha e converter conflitos únicos em mensagens de domínio. Gerar senha temporária usando `crypto.randomBytes`, devolver uma vez no router e nunca registrar seu conteúdo. Atualizar `session_not_before` por `now()` em desativação, reativação e reset. Reescrever bootstrap com as chamadas Supabase e a lock table; remover variáveis de projeto Firebase.

- [ ] **Step 4: Confirmar GREEN**

Run: `node --test tests/api/users.test.js tests/unit/user-service.test.js tests/unit/bootstrap-admin.test.js && npm run check`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/user-service.js src/server/routes/user-routes.js scripts/bootstrap-admin.js tests/api/users.test.js tests/unit/user-service.test.js tests/unit/bootstrap-admin.test.js
git commit -m "feat: manage sellers with Supabase Auth"
```

### Task 6: Migrar comissões, CSV e pagamentos atômicos para PostgreSQL

**Files:**
- Modify: `src/server/services/commission-service.js`
- Modify: `src/server/routes/commission-routes.js`
- Modify: `src/server/domain/csv.js`
- Modify: `tests/api/commissions.test.js`
- Modify: `tests/unit/commissions.test.js`
- Modify: `tests/unit/csv.test.js`

**Interfaces:**
- Produces `createCommissionService({ adminClient, now })`.
- `listCommissions({ actor, filters })` acrescenta obrigatoriamente `seller_id = actor.id` para sellers.
- `markPaid({ actor, commissionIds })` chama somente `rpc('mark_commissions_paid', { p_commission_ids, p_actor_id })`; não implementa update linha a linha.
- `voidCommission({ actor, id })` só permite admin e só altera `pending`; a migration/evento preserva histórico.

- [ ] **Step 1: Escrever testes vermelhos de isolamento e idempotência**

```js
test('seller scope is forced even when request supplies another sellerId', async () => {
  await service.listCommissions({ actor: sellerActor, filters: { sellerId: adminSellerId } });
  assert.equal(fakeAdmin.lastQuery.filters.seller_id, sellerActor.id);
});

test('markPaid delegates one atomic RPC and maps only updated commission ids', async () => {
  const result = await service.markPaid({ actor: adminActor, commissionIds: ['a', 'b'] });
  assert.deepEqual(fakeAdmin.lastRpc, {
    name: 'mark_commissions_paid',
    args: { p_commission_ids: ['a', 'b'], p_actor_id: adminActor.id },
  });
  assert.deepEqual(result.paidIds, ['a']);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test tests/api/commissions.test.js tests/unit/commissions.test.js tests/unit/csv.test.js`  
Expected: FAIL porque o serviço ainda usa coleções Firestore e reais decimais.

- [ ] **Step 3: Implementar repositório PostgreSQL e serialização**

Usar `from('commissions')` com seleção explícita e campos convertidos por `serializeCommission`. Em inserção/edição, passar somente centavos, pontos-base e metadados autorizados; deixar a coluna gerada calcular valor. O filtro de seller é decidido após validação do actor e nunca é substituível pela query do cliente. CSV recebe somente linhas já autorizadas. Pagamento em lote chama a RPC uma vez, retorna `paidIds` derivados da resposta e considera resposta vazia sucesso idempotente. Remover qualquer `delete` de comissão paga; a rota existente de exclusão passa a chamar anulação somente quando pendente.

- [ ] **Step 4: Confirmar GREEN**

Run: `node --test tests/api/commissions.test.js tests/unit/commissions.test.js tests/unit/csv.test.js && npm run check:secrets && git diff --check`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/commission-service.js src/server/routes/commission-routes.js src/server/domain/csv.js tests/api/commissions.test.js tests/unit/commissions.test.js tests/unit/csv.test.js
git commit -m "feat: persist audited commissions in Supabase"
```

### Task 7: Substituir sessão Firebase no cliente por sessão same-origin

**Files:**
- Create: `src/client/session-client.js`
- Modify: `src/client/api-client.js`
- Modify: `src/client/main.js`
- Modify: `src/client/views/login-view.js`
- Modify: `tests/unit/api-client.test.js`
- Modify: `tests/unit/login-view.test.js`
- Create: `tests/unit/session-client.test.js`
- Delete: `src/client/firebase-client.js`
- Delete: `tests/unit/firebase-client.test.js`

**Interfaces:**
- Produces `createSessionClient({ fetchImpl })` com `login`, `restore`, `logout`, `getAccessToken`, `clear`.
- `restore()` chama `POST /api/auth/refresh` com `credentials: 'same-origin'` e não usa `localStorage`.
- `createApiClient({ getAccessToken, refreshSession, onUnauthorized })` tenta refresh no máximo uma vez por lote concorrente de `401`.

- [ ] **Step 1: Escrever testes vermelhos de token efêmero e refresh deduplicado**

```js
test('session client keeps refresh token out of browser storage', async () => {
  const client = createSessionClient({ fetchImpl: loginFetch });
  await client.login({ identifier: 'seller', password: 'SenhaSegura123!' });
  assert.equal(client.getAccessToken(), 'access-token');
  assert.equal(globalThis.localStorage?.getItem('supabase.auth.token'), null);
});

test('two expired API calls share one refresh and retry once each', async () => {
  const api = createApiClient({ getAccessToken, refreshSession, onUnauthorized });
  await Promise.all([api.get('/a'), api.get('/b')]);
  assert.equal(refreshSession.calls, 1);
  assert.equal(onUnauthorized.calls, 0);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test tests/unit/session-client.test.js tests/unit/api-client.test.js tests/unit/login-view.test.js`  
Expected: FAIL porque o cliente ainda inicializa Firebase e lê `getIdToken`.

- [ ] **Step 3: Implementar cliente de sessão e adaptar bootstrap**

Remover fetch de `/api/public-config` e todos os imports Firebase. `login-view` chama `sessionClient.login`, `main.js` chama `sessionClient.restore` antes de `GET /api/me`, e logout limpa estado local mesmo se a rede falhar. `api-client` inclui Bearer apenas quando existir token, usa `credentials: 'same-origin'`, protege CSV e coordena uma Promise de refresh única. Nenhuma string de configuração Supabase entra no DOM, bundle ou localStorage.

- [ ] **Step 4: Confirmar GREEN**

Run: `node --test tests/unit/session-client.test.js tests/unit/api-client.test.js tests/unit/login-view.test.js tests/unit/format.test.js && npm run build`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/client/session-client.js src/client/api-client.js src/client/main.js src/client/views/login-view.js tests/unit/session-client.test.js tests/unit/api-client.test.js tests/unit/login-view.test.js
git rm src/client/firebase-client.js tests/unit/firebase-client.test.js
git commit -m "feat: replace browser Firebase session with API session"
```

### Task 8: Atualizar UI, scripts, documentação e scanner de migração

**Files:**
- Modify: `src/client/views/admin-view.js`
- Modify: `tests/unit/admin-view.test.js`
- Modify: `tests/unit/seller-view.test.js`
- Modify: `tests/unit/vercel-deployment.test.js`
- Modify: `scripts/assert-no-secrets.js`
- Create: `scripts/cloud-smoke.js`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Create: `docs/OPERATIONS.md`
- Modify: `package.json`
- Delete: `scripts/run-emulator-tests.js`

**Interfaces:**
- UI envia `DELETE /api/commissions/:id` somente como anulação pendente e exibe cópia “Anular comissão”, não “Excluir”.
- `scripts/cloud-smoke.js` exige `ALLOW_CLOUD_SMOKE=1`, confirma que `profiles` e `commissions` estão vazias antes de criar fixture prefixada `qa-`, e remove fixtures antes de encerrar.
- `npm run check` não referencia Firebase, emulador nem arquivos removidos.

- [ ] **Step 1: Escrever testes vermelhos de contratos visíveis e de limpeza**

```js
test('admin view calls the void endpoint and labels the action as anulação', () => {
  const view = createAdminView({ api: fakeApi });
  assert.match(view.renderCommissionActions(pendingCommission), /Anular comissão/);
  view.voidCommission('commission-id');
  assert.deepEqual(fakeApi.lastCall, ['DELETE', '/api/commissions/commission-id']);
});

test('deployment configuration never allows browser connection to Supabase', async () => {
  const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.match(vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value, /connect-src 'self'/);
  assert.doesNotMatch(JSON.stringify(vercel), /supabase\.co/);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js tests/unit/vercel-deployment.test.js`  
Expected: FAIL até a cópia, a ação e os contratos de deploy refletirem a migração.

- [ ] **Step 3: Implementar documentação e ferramentas operacionais**

Atualizar UI sem alterar o layout ou idioma: ação pendente vira “Anular comissão”; senha temporária é apresentada uma vez em elemento não persistido. Remover script e comando de emulator. Fazer scanner rejeitar os identificadores Firebase em runtime/configuração e continuar ignorando documentação histórica apenas onde necessário para explicar rollback.

`cloud-smoke.js` deve abortar se `ALLOW_CLOUD_SMOKE !== '1'`, se não houver exatamente configuração Supabase válida ou se existirem perfis/comissões. Ele cria admin/seller/duas comissões `qa-`, testa leitura seller isolada, marca uma como paga, confirma evento, remove eventos/lote/comissões/perfis e por fim exclui usuários Auth. Todo `finally` tenta limpeza e o script encerra com erro se qualquer fixture sobreviver.

`docs/OPERATIONS.md` documenta bootstrap, desativação, export/recuperação, rotação de chave e rollback. `docs/DEPLOYMENT.md` contém as variáveis Production e o deploy sem Firebase.

- [ ] **Step 4: Confirmar GREEN**

Run: `node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js tests/unit/vercel-deployment.test.js && npm run check && npm run check:secrets && git diff --check`  
Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/client/views/admin-view.js tests/unit/admin-view.test.js tests/unit/seller-view.test.js tests/unit/vercel-deployment.test.js scripts/assert-no-secrets.js scripts/cloud-smoke.js README.md docs/DEPLOYMENT.md docs/OPERATIONS.md package.json package-lock.json
git rm scripts/run-emulator-tests.js
git commit -m "docs: complete Supabase deployment operations"
```

### Task 9: Executar validação completa e revisão de branch antes da cloud

**Files:**
- Modify only if a test, build, secret scan or revisão encontrar defeito comprovado.
- Test: toda a suíte local e artefato Vite.

**Interfaces:**
- Consumes a branch sem dependências Firebase em runtime.
- Produces evidência fresca de testes, build, checks, secret scan e revisão independente; nenhuma alegação de deploy ocorre neste task.

- [ ] **Step 1: Executar a suíte completa e guardar saída de diagnóstico fora do Git**

Run:

```bash
npm test && npm run build && npm run check && npm run check:secrets && git diff --check
```

Expected: todos os comandos exit `0`.

- [ ] **Step 2: Executar busca de migração incompleta**

Run:

```bash
node --input-type=module -e "
  import { execFileSync } from 'node:child_process';
  import { readFileSync } from 'node:fs';
  const names = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean)
    .filter((name) => !name.startsWith('docs/superpowers/specs/') && name !== 'docs/DEPLOYMENT.md');
  const pattern = /firebase|firestore|identitytoolkit|securetoken|public-config/i;
  const matches = names.filter((name) => pattern.test(readFileSync(name, 'utf8')));
  if (matches.length) { console.error(matches.join('\n')); process.exit(1); }
"
```

Expected: saída vazia e exit `0`.

- [ ] **Step 3: Revisar o diff contra a spec**

Criar pacote de revisão contendo `git diff --stat 1192114..HEAD`, `git diff --check` e `git diff --find-renames 1192114..HEAD`; enviar a revisor independente com a spec e pedir veredito separado de conformidade e qualidade. Corrigir somente achados Critical/Important por ciclos TDD e revisar novamente o diff corrigido.

- [ ] **Step 4: Registrar o resultado da revisão sem commit genérico**

Se a revisão não tiver achado Critical/Important, registrar o veredito e não alterar a árvore. Se houver achado, criar antes da correção um task de revisão explícito neste plano contendo: arquivo a modificar, arquivo de teste, nome do teste vermelho, comando RED, comportamento mínimo GREEN e mensagem de commit. Executar esse novo task antes de voltar ao Task 9. Não usar staging genérico ou commit vazio.

### Task 10: Provisionar Supabase, aplicar schema, configurar Vercel e publicar

**Files:**
- Modify: `.vercel/` e `.supabase/` apenas como metadados ignorados locais; nunca adicionar ao Git.
- Modify: `.env.local` apenas como ambiente local ignorado; remover bootstrap credentials após uso.
- No tracked source changes are expected unless the cloud validation proves a defect.

**Interfaces:**
- Consumes commits validados dos Tasks 1–9.
- Produces projeto Supabase `galaxy-smart` em `sa-east-1`, migration aplicada, Auth signup público desativado, Vercel Production configurada, primeiro admin criado e URL de produção validada.

- [ ] **Step 1: Confirmar sessão Supabase sem revelar token**

Run:

```bash
npx --yes supabase@latest projects list --output-format json
```

Se a CLI pedir access token, login, senha, 2FA ou consentimento, parar e solicitar a interação do titular. Não solicitar o token em chat e não usar `--debug`.

- [ ] **Step 2: Criar ou identificar o projeto correto**

Com sessão já autorizada, listar projetos e organizações pela CLI:

```bash
npx --yes supabase@latest projects list --output-format json
npx --yes supabase@latest orgs list --output-format json
```

Se não houver projeto Galaxy Smart, gerar senha de banco somente em variável de processo e criar:

```bash
export DB_PASSWORD="$(python -c "import secrets; print(secrets.token_urlsafe(32))")"
npx --yes supabase@latest projects create galaxy-smart --org-id "$SUPABASE_ORG_ID" --region sa-east-1 --db-password "$DB_PASSWORD" --output-format json > "$LOCALAPPDATA/Temp/galaxy-smart-project.json"
```

Extrair somente o `project_ref` com Python a partir do arquivo temporário, sem imprimir o JSON. Manter `DB_PASSWORD` apenas neste processo até o fim do Step 3, quando ela será removida. Se houver projeto Galaxy Smart prévio, reutilizá-lo apenas se a região for `sa-east-1`, ele estiver vazio e a senha de banco já estiver disponível no processo; caso contrário, criar um projeto novo e vazio.

- [ ] **Step 3: Vincular, aplicar migration e lintar o banco**

Passar a senha de banco somente por variável transitória e nunca pelo Git:

```bash
npx --yes supabase@latest link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"
npx --yes supabase@latest db push --linked
npx --yes supabase@latest db lint --linked --schema public --fail-on warning
unset DB_PASSWORD
```

Depois, abrir o painel Auth somente para desativar cadastro público. Se o painel exigir login/consentimento humano, parar nessa barreira. Confirmar no banco remoto que as cinco tabelas, RLS e função de pagamento existem antes de seguir.

- [ ] **Step 4: Obter chaves sem vazamento e registrar variáveis Production da Vercel**

Capturar as chaves em arquivo temporário protegido, sem exibir conteúdo:

```bash
npx --yes supabase@latest projects api-keys --project-ref "$PROJECT_REF" --reveal --output json > "$LOCALAPPDATA/Temp/galaxy-smart-supabase-keys.json"
```

Usar este script Python temporário, que não imprime chaves, para adicionar somente Production e depois apagar o arquivo de origem:

```bash
python - "$PROJECT_REF" "$LOCALAPPDATA/Temp/galaxy-smart-supabase-keys.json" <<'PY'
import json, subprocess, sys

project_ref, key_path = sys.argv[1:]
rows = json.load(open(key_path, encoding='utf-8'))
by_name = {row['name']: row['api_key'] for row in rows}
publishable = by_name.get('publishable') or by_name.get('anon')
service = by_name.get('service_role') or by_name.get('secret')
if not publishable or not service:
    raise SystemExit('Formato de chaves Supabase não reconhecido; nenhum valor foi enviado à Vercel.')
for name, value in {
    'SUPABASE_URL': f'https://{project_ref}.supabase.co',
    'SUPABASE_PUBLISHABLE_KEY': publishable,
    'SUPABASE_SERVICE_ROLE_KEY': service,
}.items():
    subprocess.run([
        'vercel', 'env', 'add', name, 'production', '--sensitive', '--force',
        '--value', value, '--yes', '--project', 'galaxy-smart', '--scope', 'younk5s-projects',
    ], check=True, stdout=subprocess.DEVNULL)
PY
rm -f "$LOCALAPPDATA/Temp/galaxy-smart-supabase-keys.json"
```

Confirmar via `vercel env ls --project galaxy-smart --scope younk5s-projects` que os três nomes existem, sem revelar valores.

- [ ] **Step 5: Executar cloud smoke, bootstrap e deploy Production**

Com o banco confirmado vazio e variáveis locais temporárias válidas:

```bash
ALLOW_CLOUD_SMOKE=1 node scripts/cloud-smoke.js
node scripts/bootstrap-admin.js
vercel --prod --yes --project galaxy-smart --scope younk5s-projects
```

Rodar bootstrap apenas uma vez. Remover `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` da Vercel imediatamente após bootstrap; remover `.env.local` temporário e todos os arquivos em `$LOCALAPPDATA/Temp` usados para projeto/chaves.

- [ ] **Step 6: Verificar o estado externo final**

Executar, usando a URL retornada pelo deploy:

```bash
node --input-type=module - "$DEPLOY_URL" <<'NODE'
const base = process.argv[2].replace(/\/$/, '');
const health = await fetch(`${base}/health`);
const healthBody = await health.text();
const root = await fetch(`${base}/`);
const csp = root.headers.get('content-security-policy') ?? '';
const me = await fetch(`${base}/api/me`);
if (health.status !== 200 || healthBody !== '{"status":"ok"}') throw new Error('Health inválido.');
if (!csp.includes("connect-src 'self'") || !csp.includes("img-src 'self'")) throw new Error('CSP inválida.');
if (me.status !== 401) throw new Error(`GET /api/me anônimo retornou ${me.status}.`);
console.log(JSON.stringify({ health: healthBody, csp, anonymousMe: me.status }));
NODE
```

Expected: `/health` retorna somente `{"status":"ok"}`, CSP contém `connect-src 'self'` e `img-src 'self'`, `GET /api/me` anônimo retorna `401`. Verificar que `vercel ls galaxy-smart --scope younk5s-projects` inclui o deployment Production criado e que o banco não contém fixtures `qa-`.

- [ ] **Step 7: Commit somente de uma correção de código comprovada**

```bash
git status --short
git diff --check
```

Não versionar `.vercel/`, `.supabase/`, `.env.local`, artefatos temporários ou saída de chaves. Caso a validação cloud revele um defeito de código, adicionar primeiro um teste vermelho, corrigir, repetir Tasks 9–10 e só então commitar a correção.

---

## Revisão de cobertura do plano

| Requisito da spec | Task que o entrega |
|---|---|
| API same-origin e tokens de memória | 4 e 7 |
| Auth Supabase, username, cookie seguro, revogação | 4 e 5 |
| PostgreSQL, RLS deny-all, grants e transação | 2 e 6 |
| Centavos, pontos-base, carteira derivada | 3 e 6 |
| Admin/seller e isolamento | 5 e 6 |
| UI preservada e anulação financeira | 7 e 8 |
| Sem Firebase, segredos ou emulador | 1, 2 e 8 |
| Projeto São Paulo, Vercel Production, primeiro admin | 10 |
| Recuperação, cloud smoke, deployment e evidências | 8, 9 e 10 |

## Autorrevisão do plano

- Cobertura: cada requisito da spec está associado a ao menos um task na tabela acima.
- Dependências: Tasks 1–8 são sequenciais porque cada uma substitui uma camada que a seguinte consome; Task 9 verifica a branch antes de qualquer recurso cloud; Task 10 depende da evidência de Task 9.
- Placeholders: não há `TODO`, `TBD`, valores secretos, comando de commit vazio ou referência a arquivo não definido neste plano.
- Segurança: Task 10 trata login, senha, 2FA e consentimento como barreiras humanas, mantém chaves fora de stdout/Git e verifica o estado externo após escrita.
