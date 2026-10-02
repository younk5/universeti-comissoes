# Galaxy Smart Operations Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um painel administrativo seguro, auditável e confortável no celular, com visão financeira filtrada, histórico de pagamentos/anulações e backup administrativo sem dados de autenticação.

**Architecture:** A API Express continua sendo a única camada que usa o cliente administrativo do Supabase. Um serviço de comissões estendido deriva eventos financeiros das comissões autorizadas e monta contratos públicos com strings financeiras exatas. Um roteador administrativo entrega histórico e backup JSON exclusivos para admins; a view administrativa consome esses contratos e calcula visualizações apenas com as funções de soma decimal já existentes.

**Tech Stack:** Node.js 22, Express 5, Supabase JS server-side, Vite, DOM nativo, Node test runner, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-09-galaxy-operations-hardening.md`

## Global Constraints

- Não expor e-mail técnico, senha, refresh token, identidade Auth, chave ou segredo em qualquer resposta, arquivo de exportação, teste, interface ou log.
- O browser continua usando apenas a API same-origin; não recebe cliente administrativo Supabase e não acessa tabelas diretamente.
- Dinheiro permanece em centavos no banco e como strings decimais exatas no contrato/DOM; nunca usar `Number` como fonte para agregados financeiros.
- Taxas continuam em pontos-base no banco; telefone permanece opcional; e-mail não retorna ao contrato público do vendedor.
- Apenas administrador ativo acessa histórico, backup e mutações administrativas.
- Comissões e eventos financeiros nunca sofrem exclusão física; uma anulação continua sendo estado `voided` e evento auditável.
- Preservar RLS deny-all, grants de `service_role` e migrations existentes; esta entrega não necessita migration nova porque lê `commission_payment_events` já existente.
- Não criar, desativar ou modificar vendedores reais durante a validação.

---

### Task 1: Estabilizar a prova de inicialização do servidor

**Files:**
- Modify: `tests/api/server.test.js:1-47`
- Test: `tests/api/server.test.js`

**Interfaces:**
- Consumes: `server.js`, que deve continuar a responder `GET /health` com `{ status: 'ok' }` na porta definida por `PORT` sob `NODE_ENV=test`.
- Produces: um teste de processo filho que tolera contenção de CPU do runner paralelo e, caso o processo encerre, mostra o motivo diagnóstico sem vazar ambiente.

- [ ] **Step 1: Tornar o caso de falha observável no teste**

  Atualize a fixture para iniciar o processo filho com `stderr: 'pipe'`, acumular apenas a saída de diagnóstico da execução e aguardar até 7,5 segundos antes de declarar que o health não respondeu. Mantenha a asserção da resposta exata e adicione a causa de saída somente à mensagem interna da falha:

  ```js
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { stderr += chunk; });
  ```

  Faça `waitForHealth(port, { timeoutMs: 7_500, stderr: () => stderr })` falhar com mensagem `Servidor não respondeu ao health check.` seguida apenas do status/saída de processo, nunca de valores de ambiente.

- [ ] **Step 2: Executar o loop que reproduziu a flutuação**

  Run: `npm test`

  Expected: a versão anterior pode falhar em `server.js inicia o health check na porta configurada` após aproximadamente 3 segundos sob concorrência; o sinal observado anteriormente foi `TypeError: fetch failed`.

- [ ] **Step 3: Aplicar a correção mínima no próprio teste de integração**

  Preserve o processo isolado e a chamada real a `/health`; aumente o limite do teste para `10_000` ms e use o prazo explícito de 7,5 s no polling. Não altere `server.js`, `readConfig`, portas globais ou a concorrência total da suíte para esconder a flutuação.

- [ ] **Step 4: Verificar o caso focal e a suíte com a concorrência normal**

  Run: `node --test tests/api/server.test.js && npm test`

  Expected: ambos passam; o teste de inicialização continua provar a porta fornecida e a resposta JSON exata.

- [ ] **Step 5: Commit**

  ```bash
  git add tests/api/server.test.js
  git commit -m "test: stabilize server startup health probe"
  ```

### Task 2: Expor histórico financeiro e backup público de administração

**Files:**
- Create: `src/server/routes/admin-operations-routes.js`
- Modify: `src/server/services/commission-service.js:184-277`
- Modify: `src/server/app.js:1-57`
- Create: `tests/api/admin-operations.test.js`
- Modify: `tests/unit/commissions.test.js`

**Interfaces:**
- Consumes: `createCommissionService({ adminClient })`, `createUserService({ adminClient })`, `requireActor`, `requireAdmin` e as tabelas existentes `commissions`, `commission_payment_events`, `profiles`.
- Produces: `commissions.listAuditEvents({ actor, filters })`, `GET /api/audit-events`, `GET /api/admin/backup.json`.

- [ ] **Step 1: Escrever os testes vermelhos de contratos e autorização**

  Em `tests/api/admin-operations.test.js`, construa o app de teste com o mesmo padrão de `tests/api/commissions.test.js`:

  ```js
  const admin = { id: 'admin-1', role: 'admin', name: 'Admin', active: true };
  const seller = { id: 'seller-1', role: 'seller', name: 'Ana', active: true };
  const auth = { Authorization: 'Bearer token' };
  const auditEvent = {
    id: 'event-1', eventType: 'paid', previousStatus: 'pending', newStatus: 'paid',
    occurredAt: '2026-09-09T12:00:00.000Z', commissionId: 'commission-1', sellerId: 'seller-1',
    sellerName: 'Ana', product: 'Plano', saleDate: '2026-09-08', commissionValue: '12.34', actorName: 'Admin',
  };
  function appFor(actor, { commissions = {}, users = {} } = {}) {
    return createApp({
      services: {
        auth: { verifyActor: async () => actor },
        commissions,
        users,
      },
      config: { nodeEnv: 'test' },
    });
  }
  ```

  Cubra exatamente:

  ```js
  test('seller cannot read administrative audit events or backup', async () => {
    const app = appFor(seller, {
      commissions: {
        listAuditEvents: async () => ({ items: [] }),
        listCommissions: async () => ({ items: [] }),
      },
      users: { listSellers: async () => [] },
    });
    await request(app).get('/api/audit-events').set(auth).expect(403);
    await request(app).get('/api/admin/backup.json').set(auth).expect(403);
  });

  test('admin audit route forwards the active commission filters', async () => {
    const calls = [];
    const app = appFor(admin, {
      commissions: {
        listAuditEvents: async (input) => { calls.push(input); return { items: [auditEvent] }; },
        listCommissions: async () => ({ items: [] }),
      },
      users: { listSellers: async () => [] },
    });
    const response = await request(app)
      .get('/api/audit-events?sellerId=seller-1&startDate=2026-09-01&endDate=2026-09-30&paymentStatus=paid')
      .set(auth)
      .expect(200);
    assert.deepEqual(response.body, { items: [auditEvent] });
    assert.deepEqual(calls, [{ actor: admin, filters: { sellerId: 'seller-1', startDate: '2026-09-01', endDate: '2026-09-30', paymentStatus: 'paid' } }]);
  });

  test('admin backup returns public data as no-store JSON attachment', async () => {
    const app = appFor(admin, {
      commissions: {
        listCommissions: async () => ({ items: [{ id: 'commission-1', sellerName: 'Ana' }] }),
        listAuditEvents: async () => ({ items: [auditEvent] }),
      },
      users: { listSellers: async () => [{ id: 'seller-1', name: 'Ana', username: 'ana', phone: '', defaultCommissionRate: null, active: true }] },
    });
    const response = await request(app).get('/api/admin/backup.json').set(auth).expect(200);
    assert.match(response.headers['content-disposition'], /galaxy-smart-backup\.json/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(response.body).sort(), ['auditEvents', 'commissions', 'generatedAt', 'sellers']);
    assert.equal(JSON.stringify(response.body).includes('email'), false);
  });
  ```

  If the `createApp` implementation does not expose `app.locals.services`, keep the spy inside the `commissions` object passed to `appFor` and assert the same call contract; do not change production code only to aid a test.

  Em `tests/unit/commissions.test.js`, adicione o caso em que comissões autorizadas retornam eventos `paid`/`voided` em ordem decrescente de data, com `commissionValue` decimal exato, `sellerName` do snapshot e `actorName` público do profile.

- [ ] **Step 2: Rodar os testes novos e confirmar RED**

  Run: `node --test tests/api/admin-operations.test.js tests/unit/commissions.test.js`

  Expected: FAIL porque `listAuditEvents` e o roteador ainda não existem.

- [ ] **Step 3: Implementar `listAuditEvents` no serviço de comissões**

  Adicione ao objeto retornado por `createCommissionService`:

  ```js
  async listAuditEvents({ actor, filters }) {
    requireAdmin(actor);
    const { items: commissions } = await listCommissions({ actor, filters });
    if (!commissions.length) return { items: [] };
    const commissionsById = new Map(commissions.map((item) => [item.id, item]));
    const { data: rows, error } = await adminClient.from('commission_payment_events')
      .select('id, commission_id, actor_id, event_type, previous_status, new_status, created_at')
      .in('commission_id', [...commissionsById.keys()])
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Buscar somente `id, display_name` dos actor_id distintos e serializar o contrato público do spec.
  }
  ```

  O mapeamento nunca consulta/serializa `profiles.email`; quando um perfil de ator não puder ser encontrado, use `Não informado` como `actorName`.

- [ ] **Step 4: Criar o roteador administrativo com anexos seguros**

  Crie `createAdminOperationsRouter({ services })`. Ele resolve `services.commissions`/`services.users` ou seus serviços Supabase equivalentes, aplica `[requireActor(services), requireAdmin]` aos dois endpoints e implementa:

  ```js
  router.get('/audit-events', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await commissions.listAuditEvents({ actor: request.actor, filters: { ...request.query } }));
    } catch (error) { next(error); }
  });

  router.get('/admin/backup.json', ...authorizeAdmin, async (request, response, next) => {
    try {
      const [sellers, commissionResult, auditResult] = await Promise.all([
        users.listSellers(request.actor),
        commissions.listCommissions({ actor: request.actor, filters: {} }),
        commissions.listAuditEvents({ actor: request.actor, filters: {} }),
      ]);
      response
        .set('Cache-Control', 'no-store')
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Content-Disposition', 'attachment; filename="galaxy-smart-backup.json"')
        .json({ generatedAt: new Date().toISOString(), sellers, commissions: commissionResult.items, auditEvents: auditResult.items });
    } catch (error) { next(error); }
  });
  ```

  Em `src/server/app.js`, monte esse roteador sob `/api` depois dos roteadores existentes.

- [ ] **Step 5: Rodar os testes e a verificação de segredo**

  Run: `node --test tests/api/admin-operations.test.js tests/unit/commissions.test.js && npm run check`

  Expected: PASS; `assert-no-secrets` não encontra segredo novo.

- [ ] **Step 6: Commit**

  ```bash
  git add src/server/app.js src/server/routes/admin-operations-routes.js src/server/services/commission-service.js tests/api/admin-operations.test.js tests/unit/commissions.test.js
  git commit -m "feat: add audited administrative backup endpoints"
  ```

### Task 3: Construir o resumo operacional e o histórico no painel administrativo

**Files:**
- Modify: `src/client/views/admin-view.js:76-1030`
- Modify: `tests/unit/admin-view.test.js`

**Interfaces:**
- Consumes: `GET /api/commissions`, `GET /api/audit-events`, `GET /api/admin/backup.json` e os contratos públicos do spec.
- Produces: card de vendas, contador, ranking ordenado, resumo que reflete filtros ativos, aba `Histórico`, download de backup e retry de carregamento inicial.

- [ ] **Step 1: Escrever os testes vermelhos de comportamento da view**

  Em `tests/unit/admin-view.test.js`, adicione casos independentes para:

  ```js
  test('admin summarizes active commissions with sales, count and ranked sellers without Number precision loss', async () => {
    // Inclua pending, paid e voided; espere vendas/contagem/ranking apenas de pending + paid.
  });

  test('admin loads financial history only when its tab is selected and carries confirmed filters', async () => {
    // A primeira carga não chama /api/audit-events; clique em Histórico chama a rota com a query confirmada.
  });

  test('admin downloads the no-store JSON backup without exposing hidden account fields', async () => {
    // Espere api.download('/api/admin/backup.json') e nome galaxy-smart-backup.json.
  });

  test('admin retries an initial load after a failure without changing entered filters', async () => {
    // A primeira Promise.all falha, o botão Tentar novamente reexecuta as duas leituras e restaura a UI.
  });
  ```

- [ ] **Step 2: Rodar a view e confirmar RED**

  Run: `node --test tests/unit/admin-view.test.js`

  Expected: FAIL porque os elementos/controles e handlers novos não existem.

- [ ] **Step 3: Adicionar agregadores exatos e cards de operação**

  Em `admin-view.js`, crie funções puras próximas de `commissionTotals`:

  ```js
  function operationalCommissions(commissions) {
    return commissions.filter((commission) => commission.paymentStatus === 'pending' || commission.paymentStatus === 'paid');
  }

  function operationalSummary(commissions) {
    const active = operationalCommissions(commissions);
    return active.reduce((summary, commission) => ({
      count: summary.count + 1,
      sales: sumCurrency(summary.sales, commission.saleValue),
      pending: commission.paymentStatus === 'pending' ? sumCurrency(summary.pending, commission.commissionValue) : summary.pending,
      paid: commission.paymentStatus === 'paid' ? sumCurrency(summary.paid, commission.commissionValue) : summary.paid,
    }), { count: 0, sales: '0.00', pending: '0.00', paid: '0.00' });
  }
  ```

  Renderize cards `Vendas registradas`, `A pagar`, `Pago`, `Total de comissões` e `Registros`. Refaça `sellerTotals` para ignorar `voided`, ordenar por total descrescente e apresentar a posição. Deixe uma mensagem textual de que as comissões anuladas ficam fora do resumo operacional.

- [ ] **Step 4: Adicionar aba Histórico e backup**

  Acrescente a aba real `Histórico` com ARIA igual às demais. No primeiro acionamento, chame `api.request('/api/audit-events' + filterQuery())`; em filtros posteriores, invalide o cache de histórico e mostre um botão `Atualizar histórico` que usa a query confirmada. Renderize `Pagamento`/`Anulação`, vendedor, produto, comissão, responsável e data/hora local em uma tabela.

  No painel `Resumo`, adicione botão `Baixar cópia administrativa`. Use `api.download('/api/admin/backup.json')`, Blob, Object URL e `galaxy-smart-backup.json`; mantenha botão desabilitado durante o download e comunique sucesso/erro em `aria-live`.

- [ ] **Step 5: Adicionar retry e preservar estado seguro**

  Separe `load()` em `loadInitialData()`. Se a carga inicial falhar, mantenha ações protegidas e renderize um botão `Tentar novamente` no resumo. O retry só reativa ações depois de ambas as leituras essenciais resolverem; não limpe controles de filtro nem os últimos dados confirmados quando uma carga posterior falhar.

- [ ] **Step 6: Rodar o ciclo da view**

  Run: `node --test tests/unit/admin-view.test.js && node --check src/client/views/admin-view.js`

  Expected: PASS, sem erros de sintaxe.

- [ ] **Step 7: Commit**

  ```bash
  git add src/client/views/admin-view.js tests/unit/admin-view.test.js
  git commit -m "feat: improve administrative operations dashboard"
  ```

### Task 4: Adaptar a operação para celular e concluir os estados visuais

**Files:**
- Modify: `src/client/views/admin-view.js:15-1030`
- Modify: `src/client/styles/app.css:1-865`
- Modify: `index.html:1-12`
- Modify: `tests/unit/admin-view.test.js`

**Interfaces:**
- Consumes: células administrativas com `data-label`, os nomes de classes existentes e o contrato de view da Task 3.
- Produces: tabelas administrativas que se tornam cartões em até 560px, alvos de toque de no mínimo 44px, estados de erro/loading/empty e viewport compatível com safe area.

- [ ] **Step 1: Escrever os testes vermelhos de semântica móvel**

  Adicione um teste que renderiza vendedor, ranking, comissão e evento histórico e verifica os `data-label` em cada célula administrativa exibida. Verifique também que a linha vazia não recebe pseudo-rótulos de dados e que os novos botões expostos (`retryInitialLoad`, `backupButton`, `refreshAuditButton`) possuem texto em português.

- [ ] **Step 2: Rodar o teste novo e confirmar RED**

  Run: `node --test tests/unit/admin-view.test.js`

  Expected: FAIL porque as células administrativas ainda não carregam os rótulos móveis completos.

- [ ] **Step 3: Marcar as células e aplicar layout cartão no CSS**

  Atualize `createCell` para aceitar `attributes` e passe `data-label` em todas as células de ranking, vendedores, comissões e histórico. Em `@media (max-width: 560px)`, transforme apenas as tabelas administrativas em grade de cartões, esconda `thead`, mantenha o primeiro dado como título em largura total e use `td::before { content: attr(data-label) }`. Preserve `table-empty-row` sem `::before` e sem rolagem horizontal.

  Garanta `min-height: 44px` para `.button`, `.admin-tab` e controles tocáveis em ponteiro coarse; não esconda funcionalidades no mobile. Substitua valores de altura inferiores a 16px para inputs de dados com piso legível de 16px em mobile.

- [ ] **Step 4: Ajustar estados e superfícies do navegador**

  Inclua estilos distintos para `.form-feedback[data-state='success']`, `.form-feedback[data-state='error']`, controles desabilitados e botões em carregamento. Garanta `overflow-wrap:anywhere` em campos de texto, nomes, produtos e ações; preserve `font-variant-numeric: tabular-nums` em valores financeiros. Atualize a viewport para:

  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  ```

  Use `padding-bottom: max(1rem, env(safe-area-inset-bottom))` no shell móvel, sem blur decorativo, emoji, texto em inglês ou cartão aninhado.

- [ ] **Step 5: Verificar testes e sintaxe**

  Run: `node --test tests/unit/admin-view.test.js && node --check src/client/views/admin-view.js && npm run check`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/client/views/admin-view.js src/client/styles/app.css index.html tests/unit/admin-view.test.js
  git commit -m "feat: harden admin operations for mobile use"
  ```

### Task 5: Validar o artefato, revisar e publicar

**Files:**
- Modify only if a verification defect requires a tested correction.
- Test: all `tests/unit/*.test.js`, `tests/api/*.test.js`, Vercel build and production endpoints.

**Interfaces:**
- Consumes: branch `feat/supabase-platform`, URL de produção `https://galaxy-smart.vercel.app` e a configuração Vercel já existente.
- Produces: build, deploy e validação funcional sem criar ou modificar contas reais.

- [ ] **Step 1: Rodar qualidade local completa**

  Run:

  ```bash
  npm test && npm run check && git diff --check && npx.cmd vercel build --prod --yes
  ```

  Expected: todos os testes passam, segredos são bloqueados, nenhum whitespace error e o build Vercel cria as rotas.

- [ ] **Step 2: Validar a UI em desktop e mobile antes do deploy**

  Inicie `npm run dev` em `127.0.0.1`, aguarde o health check e, via navegador, verifique a página de login em 1280px e 390px. Teste programaticamente que `document.documentElement.scrollWidth - document.documentElement.clientWidth === 0` em ambos. Para estados autenticados, injete somente estrutura idêntica às classes reais se uma sessão não estiver disponível; não invente dados nem autentique com credenciais desconhecidas.

- [ ] **Step 3: Rodar detector visual obrigatório**

  Run:

  ```bash
  node C:/Users/vinic/AppData/Local/hermes/skills/design/impeccable/scripts/detect.mjs --json src/client/views/admin-view.js src/client/styles/app.css index.html
  ```

  Expected: nenhum erro bloqueante; corrigir somente problemas reais observados antes de seguir.

- [ ] **Step 4: Revisão independente de código**

  Gere o diff desde `git merge-base main HEAD`, faça varredura de segredos/inputs e despache revisor independente com o pacote de diff. Corrija qualquer finding crítico/importante com teste e reexecute uma revisão focada.

- [ ] **Step 5: Publicar produção e confirmar rotas reais**

  Run:

  ```bash
  npx.cmd vercel --prod --yes
  curl.exe -fsS -w "\nhealth_status=%{http_code}\n" https://galaxy-smart.vercel.app/health
  curl.exe -sS -o NUL -w "login_status=%{http_code}\n" -X POST https://galaxy-smart.vercel.app/api/auth/login -H "Content-Type: application/json" --data "{\"username\":\"usuario-inexistente\",\"password\":\"senha-invalida-123\"}"
  ```

  Expected: health `200`; login é uma resposta de aplicação (`400`/`401`) e nunca roteamento `404`/plataforma `5xx`. Use sessão existente apenas se ela já estiver disponível para conferir o dashboard; não peça ou registre senha no chat.

- [ ] **Step 6: Commit final e registrar a entrega**

  ```bash
  git add -A
  git commit -m "[verified] deliver audit-ready Galaxy Smart operations"
  ```

  Relate hash, URL, testes e qualquer limite residual comprovado.

## Self-review

- Cobertura: Task 1 cobre confiabilidade; Task 2 endpoints e segurança; Task 3 visão, filtros, ranking, histórico e backup; Task 4 mobile, estados e acessibilidade; Task 5 UI/build/review/deploy.
- Placeholder scan: nenhum `TODO`, requisito implícito ou passo sem arquivo/contrato/comando.
- Type consistency: `listAuditEvents({ actor, filters })` é produzido na Task 2 e consumido no roteador/Task 3; contratos de backup usam `sellers`, `commissions` e `auditEvents` definidos no spec.
