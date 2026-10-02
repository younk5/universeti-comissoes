# Central de segurança dos dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o proprietário baixe, valide, restaure e recupere backups dos dados financeiros locais da Galaxy Smart sem backend.

**Architecture:** `app.js` continuará como um único arquivo clássico, mas as regras de backup serão funções puras exportadas por `CommissionLogic` e cobertas por `node:test`. O estado operacional segue em `controle-comissoes.v1`; metadados de exportação e a cópia interna ficam em chaves separadas do `localStorage`. A restauração sempre substitui o conjunto inteiro após prévia e confirmação explícita.

**Tech Stack:** HTML5, CSS3, JavaScript puro, `localStorage`, `Blob`, `FileReader`, Node.js `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-07-seguranca-dados-design.md`

## Global Constraints

- Manter o aplicativo estático, sem dependências, build, conta, servidor ou nuvem.
- Preservar `controle-comissoes.v1` e compatibilidade com estados antigos sem `withdrawals`.
- Todo texto visível fica em pt-BR e o tema escuro Galaxy Smart permanece intacto.
- O backup externo é JSON; CSV continua somente como relatório de comissões.
- Importação não mescla dados: substitui vendedores, comissões e retiradas apenas após confirmação.
- Arquivo externo inválido nunca altera `localStorage` nem o estado em memória.
- Toda função nova de domínio precisa nascer de um teste que falha antes da implementação.
- Não declarar conclusão sem testes Node, `node --check`, `git diff --check`, persistência real e responsividade em navegador.

---

## Estrutura de arquivos e limites

| Arquivo | Responsabilidade após a mudança |
|---|---|
| `app.js` | Contratos de backup/recovery, persistência, controles e renderização da Central de segurança. |
| `tests/app.test.js` | Regras puras de serialização, validação, prévia e snapshots de recuperação. |
| `index.html` | Seção semântica de segurança, campo oculto de arquivo, prévia e ações de confirmação. |
| `style.css` | Layout responsivo da seção, status e prévia no tema existente. |
| `README.md` | Instruções de backup externo e restauração para o proprietário. |
| `docs/PRD.md` | Requisito funcional, riscos e critérios de aceite do backup local. |

## Contratos a introduzir

```js
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_APP_NAME = 'Galaxy Smart Controle de Comissões';
const BACKUP_META_KEY = 'controle-comissoes.backup-meta.v1';
const RECOVERY_KEY = 'controle-comissoes.recovery.v1';
```

- `buildBackupEnvelope(state, exportedAt)` retorna o envelope externo com `app`, `schemaVersion`, `exportedAt` e clone de `state`.
- `validateBackupEnvelope(payload)` retorna `{ valid: true, value: payload }` ou `{ valid: false, error }`.
- `summarizeBackupState(state)` retorna `{ sellers, commissions, withdrawals }` com as contagens.
- `buildRecoverySnapshot(state, reason, savedAt)` retorna `{ schemaVersion, savedAt, reason, state }`.
- `validateRecoverySnapshot(payload)` retorna o snapshot válido ou um erro de validação.
- `saveRecoverySnapshot(storage, state, reason, savedAt)` grava `RECOVERY_KEY`.
- `loadRecoverySnapshot(storage)` retorna snapshot válido ou `null`.
- `saveBackupMeta(storage, meta)` grava o campo `lastExportedAt`.
- `loadBackupMeta(storage)` retorna `{ lastExportedAt: null }` quando a chave está ausente ou inválida.

`validateBackupEnvelope` aceita somente envelopes cuja propriedade `app` seja exatamente `Galaxy Smart Controle de Comissões`, cujo `schemaVersion` seja `1`, cuja `exportedAt` seja uma string não vazia e cujo `state` contenha coleções válidas. Cada vendedor deve ter `id` e `name`; cada comissão deve ter `id`, `sellerId`, `sellerName`, `saleValue`, `commissionValue`, `commissionType` válido e `saleDate`; cada retirada deve ter `id`, `sellerId`, `sellerName`, `value` e `withdrawalDate`. Todos os IDs de comissão e retirada precisam apontar para um vendedor presente no mesmo backup.

### Task 1: Contrato versionado de backup e validação rígida

**Files:**
- Modify: `app.js:3-71` e `app.js:295-325`
- Modify: `tests/app.test.js:1-38` e final do arquivo

**Interfaces:**
- Consumes: `createEmptyState`, `sanitizeState` e as coleções existentes.
- Produces: `BACKUP_SCHEMA_VERSION`, `BACKUP_APP_NAME`, `buildBackupEnvelope`, `validateBackupEnvelope` e `summarizeBackupState` exportados em `CommissionLogic`.

- [ ] **Step 1: Escrever os testes que falham para o envelope válido e a prévia**

Adicionar no final de `tests/app.test.js`:

```js
const {
  BACKUP_APP_NAME,
  buildBackupEnvelope,
  validateBackupEnvelope,
  summarizeBackupState,
} = require('../app.js');

test('gera envelope versionado de backup com os dados completos', () => {
  const state = {
    sellers: [{ id: 'ana', name: 'Ana' }],
    commissions: [{ id: 'c1', sellerId: 'ana', sellerName: 'Ana', saleValue: 100, commissionValue: 10, commissionType: 'fixed', saleDate: '2026-09-07' }],
    withdrawals: [{ id: 'r1', sellerId: 'ana', sellerName: 'Ana', value: 5, withdrawalDate: '2026-09-07' }],
  };
  const backup = buildBackupEnvelope(state, '2026-09-07T12:00:00.000Z');
  assert.equal(backup.app, BACKUP_APP_NAME);
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.exportedAt, '2026-09-07T12:00:00.000Z');
  assert.deepEqual(summarizeBackupState(backup.state), { sellers: 1, commissions: 1, withdrawals: 1 });
  assert.deepEqual(validateBackupEnvelope(backup), { valid: true, value: backup });
});
```

- [ ] **Step 2: Rodar o teste e confirmar falha por função ausente**

Run:

```bash
node --test --test-name-pattern="envelope versionado" tests/app.test.js
```

Expected: falha informando que `buildBackupEnvelope` não existe.

- [ ] **Step 3: Escrever os testes que falham para arquivos rejeitados**

Adicionar o cenário abaixo:

```js
test('rejeita backup sem identificador, versão ou referência de vendedor válida', () => {
  assert.deepEqual(validateBackupEnvelope({}), {
    valid: false,
    error: 'Este arquivo não é um backup válido da Galaxy Smart.',
  });

  const invalid = {
    app: BACKUP_APP_NAME,
    schemaVersion: 1,
    exportedAt: '2026-09-07T12:00:00.000Z',
    state: {
      sellers: [],
      commissions: [{ id: 'c1', sellerId: 'ausente', sellerName: 'Ana', saleValue: 100, commissionValue: 10, commissionType: 'fixed', saleDate: '2026-09-07' }],
      withdrawals: [],
    },
  };
  assert.deepEqual(validateBackupEnvelope(invalid), {
    valid: false,
    error: 'O backup possui movimentações sem vendedor válido.',
  });
});
```

- [ ] **Step 4: Rodar o teste inválido e confirmar falha**

Run:

```bash
node --test --test-name-pattern="rejeita backup" tests/app.test.js
```

Expected: falha porque `validateBackupEnvelope` ainda não aplica o contrato.

- [ ] **Step 5: Implementar o conjunto mínimo de funções puras**

No topo de `app.js`, após `STORAGE_KEY`, adicionar as constantes e helpers. A validação deve retornar os erros exatos usados nos testes:

```js
function summarizeBackupState(state) {
  return {
    sellers: state.sellers.length,
    commissions: state.commissions.length,
    withdrawals: state.withdrawals.length,
  };
}

function buildBackupEnvelope(state, exportedAt = new Date().toISOString()) {
  return {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    state: JSON.parse(JSON.stringify(sanitizeState(state))),
  };
}
```

Adicionar `isValidBackupState(state)` para validar coleções, campos essenciais, valores numéricos finitos, tipos permitidos e referências a `sellerId`. `validateBackupEnvelope(payload)` só chama `isValidBackupState` depois de validar identificador, versão e `exportedAt`; então retorna o envelope sem alterar seu conteúdo. Exportar as três funções e as duas constantes em `CommissionLogic`.

- [ ] **Step 6: Rodar os testes específicos e a suíte completa**

Run:

```bash
node --test --test-name-pattern="backup" tests/app.test.js
node --test tests/app.test.js
```

Expected: ambos retornam exit code `0`.

- [ ] **Step 7: Commitar o contrato de backup**

```bash
git add app.js tests/app.test.js
git commit -m "feat: add validated backup contract"
```

### Task 2: Metadados e cópia interna de recuperação

**Files:**
- Modify: `app.js:3-71`, `app.js:380-420`, e todos os caminhos que chamam `persistState()`
- Modify: `tests/app.test.js`

**Interfaces:**
- Consumes: `validateBackupEnvelope`, `summarizeBackupState` e `window.localStorage`.
- Produces: `buildRecoverySnapshot`, `validateRecoverySnapshot`, `saveRecoverySnapshot`, `loadRecoverySnapshot`, `saveBackupMeta`, `loadBackupMeta` e uma persistência que mantém estado principal e recuperação em chaves diferentes.

- [ ] **Step 1: Escrever o teste que falha para a cópia de recuperação**

```js
const {
  buildRecoverySnapshot,
  loadRecoverySnapshot,
  saveRecoverySnapshot,
  loadBackupMeta,
  saveBackupMeta,
} = require('../app.js');

test('salva e recupera uma cópia interna válida em chave separada', () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) };
  const state = { sellers: [{ id: 'ana', name: 'Ana' }], commissions: [], withdrawals: [] };

  assert.deepEqual(buildRecoverySnapshot(state, 'pre-restore', '2026-09-07T12:00:00.000Z').reason, 'pre-restore');
  saveRecoverySnapshot(storage, state, 'automatic', '2026-09-07T12:00:00.000Z');
  assert.deepEqual(loadRecoverySnapshot(storage).state, state);
  assert.deepEqual(loadBackupMeta(storage), { lastExportedAt: null });
  saveBackupMeta(storage, { lastExportedAt: '2026-09-07T13:00:00.000Z' });
  assert.deepEqual(loadBackupMeta(storage), { lastExportedAt: '2026-09-07T13:00:00.000Z' });
});
```

- [ ] **Step 2: Rodar o teste e confirmar falha por funções ausentes**

Run:

```bash
node --test --test-name-pattern="cópia interna válida" tests/app.test.js
```

Expected: falha apontando a primeira função não exportada.

- [ ] **Step 3: Implementar snapshots, metadados e leitura segura**

Criar as chaves `BACKUP_META_KEY` e `RECOVERY_KEY`. `buildRecoverySnapshot` deve usar `buildBackupEnvelope(state, savedAt).state` e retornar:

```js
{
  schemaVersion: BACKUP_SCHEMA_VERSION,
  savedAt,
  reason,
  state,
}
```

`loadRecoverySnapshot` deve retornar `null` quando a chave estiver ausente, o JSON for inválido, a versão não for `1`, o motivo não for `automatic` ou `pre-restore`, ou o estado falhar na validação rígida. `loadBackupMeta` deve retornar `{ lastExportedAt: null }` para chave ausente ou inválida.

- [ ] **Step 4: Escrever o teste que falha para snapshot inválido**

```js
test('ignora cópia interna corrompida sem apagar o estado principal', () => {
  const storage = { getItem: () => '{invalido', setItem: () => {} };
  assert.equal(loadRecoverySnapshot(storage), null);
});
```

- [ ] **Step 5: Rodar o teste inválido e confirmar falha**

Run:

```bash
node --test --test-name-pattern="cópia interna corrompida" tests/app.test.js
```

Expected: falha enquanto `loadRecoverySnapshot` não tratar JSON inválido.

- [ ] **Step 6: Integrar persistência normal sem mascarar falha do estado principal**

No bloco de navegador, iniciar `let backupMeta = loadBackupMeta(window.localStorage);`. Alterar `persistState()` para primeiro chamar `saveState(window.localStorage, state)`. Somente depois gravar `saveRecoverySnapshot(window.localStorage, state, 'automatic')`; se essa segunda gravação falhar, manter o estado principal salvo e exibir `Dados salvos, mas a cópia interna não pôde ser atualizada.`. Falha em `saveState` continua retornando `false` e não afirma que houve salvamento.

Criar duas funções de fluxo, sem eventos de interface ainda:

```js
function replaceStateFromBackup(nextState, reason) {
  saveRecoverySnapshot(window.localStorage, state, reason);
  saveState(window.localStorage, nextState);
  state = nextState;
}

function getRecoverySnapshot() {
  return loadRecoverySnapshot(window.localStorage);
}
```

A chamada de restauração real será ligada na Task 4. Não chamar `persistState()` após `replaceStateFromBackup`, pois isso sobrescreveria a cópia pré-restauração com o estado recém-importado.

- [ ] **Step 7: Rodar testes e verificação de sintaxe**

Run:

```bash
node --test tests/app.test.js
node --check app.js
```

Expected: exit code `0` para ambos.

- [ ] **Step 8: Commitar a recuperação interna**

```bash
git add app.js tests/app.test.js
git commit -m "feat: add internal data recovery"
```

### Task 3: Central de segurança na interface

**Files:**
- Modify: `index.html:44-46`
- Modify: `style.css:68-88`, `style.css:171-185` e `style.css:187-203`

**Interfaces:**
- Consumes: os IDs de controle definidos abaixo e variáveis do tema já existentes.
- Produces: uma seção acessível e responsiva que a Task 4 conecta aos fluxos de backup.

- [ ] **Step 1: Inserir os controles sem comportamento JavaScript**

Depois de `</section>` do resumo e antes de `<div class="workbench-grid">`, inserir:

```html
<section id="seguranca" class="panel panel-security" aria-labelledby="security-title">
  <div class="section-heading">
    <div>
      <h2 id="security-title">Segurança dos dados</h2>
      <p class="section-description">Baixe uma cópia para guardar fora do navegador. A cópia interna ajuda em recuperações locais, mas não protege contra a limpeza dos dados do navegador.</p>
    </div>
  </div>
  <div class="security-grid">
    <article class="security-status-card">
      <h3>Backup externo</h3>
      <p id="backup-export-status">Ainda não há backup registrado neste navegador.</p>
      <button id="backup-download" class="button" type="button">Baixar backup agora</button>
    </article>
    <article class="security-status-card">
      <h3>Recuperação interna</h3>
      <p id="backup-recovery-status">Nenhuma cópia interna disponível.</p>
      <button id="backup-recovery-restore" class="button button-secondary" type="button" disabled>Restaurar cópia interna</button>
    </article>
  </div>
  <div class="security-import">
    <h3>Restaurar backup</h3>
    <p>Escolha um arquivo JSON baixado pela Galaxy Smart. A restauração substitui todos os dados atuais.</p>
    <input id="backup-file" type="file" accept="application/json,.json" hidden>
    <div class="form-actions">
      <button id="backup-file-trigger" class="button button-secondary" type="button">Selecionar arquivo de backup</button>
      <button id="backup-restore" class="button button-danger" type="button" disabled>Restaurar este backup</button>
    </div>
    <p id="backup-error" class="error-message" role="alert" hidden></p>
    <div id="backup-preview" class="backup-preview" aria-live="polite" hidden></div>
  </div>
</section>
```

- [ ] **Step 2: Adicionar estilos de painel, status e prévia**

Usar somente tokens existentes. Adicionar `.section-description`, `.security-grid`, `.security-status-card`, `.security-import` e `.backup-preview`. Os cartões devem usar `--surface-raised`, bordas `--border` e 44px de altura mínima nos botões. Em 700px, `.security-grid` tem duas colunas; abaixo disso, uma coluna. Não alterar o layout de carteiras, comissões ou histórico.

- [ ] **Step 3: Verificar a estrutura no navegador antes da ligação de eventos**

Run:

```bash
node --check app.js
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/index.html
```

Expected: `node --check` retorna `0`; o código HTTP é `200` (o Git Bash pode retornar `23` após imprimir o `200`).

- [ ] **Step 4: Validar responsividade estrutural**

No navegador, abrir `http://127.0.0.1:4173/`, aplicar viewport de 390px e confirmar:

```js
({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  cards: document.querySelectorAll('.security-status-card').length,
  downloadHeight: document.querySelector('#backup-download').getBoundingClientRect().height,
})
```

Expected: `overflow === 0`, `cards === 2`, `downloadHeight >= 42`.

- [ ] **Step 5: Commitar a interface estática**

```bash
git add index.html style.css
git commit -m "feat: add data safety panel"
```

### Task 4: Download, prévia, restauração e recuperação pela interface

**Files:**
- Modify: `app.js:330-420`, `app.js:881-902`, `app.js:1047-1077`
- Modify: `tests/app.test.js`

**Interfaces:**
- Consumes: os IDs da Task 3, `buildBackupEnvelope`, `validateBackupEnvelope`, `summarizeBackupState`, `loadRecoverySnapshot`, `saveBackupMeta` e `replaceStateFromBackup`.
- Produces: download JSON, prévia não destrutiva, restauração confirmada e recuperação interna confirmada.

- [ ] **Step 1: Escrever o teste que falha para restauração sem mutar o estado original**

```js
const { restoreStateFromValidatedBackup } = require('../app.js');

test('prepara restauração com cópia independente do backup validado', () => {
  const backup = buildBackupEnvelope({ sellers: [], commissions: [], withdrawals: [] }, '2026-09-07T12:00:00.000Z');
  const restored = restoreStateFromValidatedBackup(backup);
  restored.sellers.push({ id: 'nova', name: 'Nova' });
  assert.equal(backup.state.sellers.length, 0);
  assert.deepEqual(restored, { sellers: [{ id: 'nova', name: 'Nova' }], commissions: [], withdrawals: [] });
});
```

- [ ] **Step 2: Rodar o teste e confirmar falha**

Run:

```bash
node --test --test-name-pattern="restauração com cópia independente" tests/app.test.js
```

Expected: falha porque `restoreStateFromValidatedBackup` ainda não existe.

- [ ] **Step 3: Implementar a cópia de restauração e os helpers de download**

Implementar `restoreStateFromValidatedBackup(backup)` para retornar clone profundo de `backup.state` após `validateBackupEnvelope(backup)` retornar válido; em caso inválido, retornar `null`.

No bloco de navegador, adicionar referências DOM para todos os IDs da Task 3 e uma variável `let pendingBackup = null;`. Criar helper de download baseado no padrão existente de CSV:

```js
function downloadJson(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

`#backup-download` deve gerar o envelope, baixar JSON formatado com `JSON.stringify(backup, null, 2)`, atualizar `backupMeta.lastExportedAt`, salvar metadados e renderizar o status.

- [ ] **Step 4: Implementar prévia de arquivo sem persistir dados**

No evento `change` de `#backup-file`:

1. limpar `pendingBackup`, erro e prévia anterior;
2. ler somente o primeiro arquivo via `await file.text()`;
3. executar `JSON.parse` em `try/catch`;
4. chamar `validateBackupEnvelope`;
5. em erro, exibir texto em `#backup-error`, manter `#backup-restore.disabled = true` e não chamar `saveState`;
6. em sucesso, salvar o envelope em `pendingBackup`, preencher `#backup-preview` com data e contagens de `summarizeBackupState`, remover `hidden` e habilitar `#backup-restore`.

A cópia deve ser: `Backup de DD/MM/AAAA às HH:MM · X vendedores · Y comissões · Z retiradas.`

- [ ] **Step 5: Implementar as duas confirmações destrutivas**

No clique de `#backup-restore`, obter `nextState = restoreStateFromValidatedBackup(pendingBackup)`. Exigir:

```js
window.confirm(`Restaurar este backup? Os dados atuais serão substituídos por ${summary.sellers} vendedores, ${summary.commissions} comissões e ${summary.withdrawals} retiradas.`)
```

Após confirmação, chamar `replaceStateFromBackup(nextState, 'pre-restore')`, limpar seleção e prévia, recarregar `backupMeta`, chamar `renderAll()` e `renderSecurity()`, e mostrar `Backup restaurado. A base anterior ficou disponível na cópia interna.`

No clique de `#backup-recovery-restore`, carregar snapshot. Se ausente, mostrar erro e retornar. Se presente, confirmar com data e contagens, usar `replaceStateFromBackup(snapshot.state, 'pre-restore')`, chamar renderizações e mostrar `Cópia interna restaurada.`

Criar `renderSecurity()` e chamá-la no final de `renderAll()`. Ela atualiza os dois status, habilita recuperação apenas quando houver snapshot válido e não expõe detalhes técnicos de chaves do navegador.

- [ ] **Step 6: Rodar teste específico, suíte e verificação estática**

Run:

```bash
node --test --test-name-pattern="restauração com cópia independente" tests/app.test.js
node --test tests/app.test.js
node --check app.js
git diff --check
```

Expected: todos retornam exit code `0`.

- [ ] **Step 7: Validar o fluxo real no navegador em perfil de QA**

1. Abrir `http://127.0.0.1:4173/` em perfil temporário e gravar estado com dois vendedores, três comissões e uma retirada.
2. Clicar **Baixar backup agora** e confirmar que o status mostra a exportação.
3. Criar um `File` no contexto do navegador com o JSON do backup e atribuí-lo a `#backup-file` por `DataTransfer`; disparar `change`.
4. Confirmar que a prévia mostra `2 vendedores`, `3 comissões`, `1 retirada` e que o `localStorage` não mudou antes da confirmação.
5. Alterar o estado no navegador para uma base diferente, acionar restauração com confirmação controlada e confirmar que resumo, carteiras e histórico voltam aos números do backup.
6. Alterar novamente a base, usar **Restaurar cópia interna** e confirmar que retorna ao estado salvo antes da restauração.
7. Repetir a seleção com JSON inválido e confirmar que o erro aparece, o botão fica desabilitado e nenhum dado é perdido.
8. Repetir a inspeção em 390px e confirmar `document.documentElement.scrollWidth - document.documentElement.clientWidth === 0`.

- [ ] **Step 8: Commitar os fluxos de segurança**

```bash
git add app.js tests/app.test.js
git commit -m "feat: add backup and restore flows"
```

### Task 5: Documentação, critérios de aceite e encerramento

**Files:**
- Modify: `README.md`
- Modify: `docs/PRD.md`

**Interfaces:**
- Consumes: o comportamento entregue nas Tasks 1 a 4.
- Produces: instruções operacionais coerentes e critérios de aceite atualizados.

- [ ] **Step 1: Documentar backup externo e limites no README**

Adicionar uma seção **Backup e recuperação** explicando, em linguagem simples:

- usar **Baixar backup agora** depois de lançamentos importantes;
- guardar o JSON em pasta fora do navegador, como `Documentos` ou OneDrive;
- restauração substitui toda a base atual;
- a cópia interna serve para recuperação local e não protege contra limpeza de dados do navegador;
- CSV não restaura o sistema.

- [ ] **Step 2: Atualizar o PRD**

Adicionar requisito funcional de backup JSON com prévia, confirmação e cópia interna pré-restauração. Atualizar riscos para listar perda por limpeza do navegador e mitigação por download externo. Incluir critérios verificáveis para arquivo inválido, substituição total confirmada e recuperação interna.

- [ ] **Step 3: Executar a verificação final no repositório**

Run:

```bash
node --test --test-reporter=spec tests/app.test.js
node --check app.js
git diff --check
git status --short
```

Expected: todos os testes passam, sintaxe e diff não têm erros, e apenas os dois documentos aparecem como modificados antes do commit.

- [ ] **Step 4: Commitar a documentação**

```bash
git add README.md docs/PRD.md
git commit -m "docs: explain data backup and recovery"
```

- [ ] **Step 5: Verificar o commit final**

Run:

```bash
git status --porcelain
git log -1 --oneline
```

Expected: `git status --porcelain` não imprime arquivos e o log mostra o commit de documentação.

## Revisão do plano

- Cobertura da especificação: Task 1 cobre envelope, versão, validação e prévia de contagens; Task 2 cobre chaves internas, metadados e recuperação; Task 3 cobre a seção responsiva; Task 4 cobre download, seleção, prévia, substituição e restauração real; Task 5 cobre documentação e aceite.
- Consistência: todas as Tasks usam `BACKUP_SCHEMA_VERSION`, `BACKUP_APP_NAME`, `validateBackupEnvelope`, `summarizeBackupState`, `replaceStateFromBackup` e as mesmas três coleções de estado.
- Escopo: não cria backend, nuvem, login, mesclagem parcial, CSV reversível ou histórico de múltiplas versões.
- Sem placeholders: passos, comandos, mensagens, IDs, chaves de armazenamento e contratos estão definidos neste documento.
