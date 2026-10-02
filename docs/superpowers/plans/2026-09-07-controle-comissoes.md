# Controle de Comissões Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma aplicação web local, responsiva e sem dependências para cadastrar vendedores, registrar comissões e consultar/exportar o histórico persistido no navegador.

**Architecture:** Um único `app.js` clássico contém lógica pura testável em Node e o controlador do DOM protegido por `typeof document !== "undefined"`. O estado versionado fica em `localStorage`; uma única função de filtragem alimenta tabela, resumo, gráfico e CSV. `index.html` define a estrutura acessível e `style.css` aplica layout mobile-first sem fontes ou bibliotecas remotas.

**Tech Stack:** HTML5, CSS3, JavaScript ES2022 clássico, Web Storage API, `Intl.NumberFormat`, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-controle-comissoes-design.md`

## Global Constraints

- Interface, mensagens de validação, comentários e README em pt-BR.
- Sem framework, dependência externa, build, API, backend, fonte remota, rastreador, segredo ou chamada de rede.
- O app abre com duplo clique em `index.html`; usar scripts clássicos com `defer`, nunca módulos ES.
- Chave de persistência: `controle-comissoes.v1`.
- Valores internos são números em BRL, datas de venda usam `YYYY-MM-DD` e a exibição usa `pt-BR`/BRL.
- Vendedor exige nome; comissão exige vendedor, venda, tipo e valor; produto e observação são opcionais.
- Venda e comissão devem ser números finitos maiores que zero. Percentual acima de 100 é permitido.
- Vendedor com comissão vinculada não pode ser excluído; comissão excluída exige confirmação.
- A comissão calculada é gravada no momento do registro e não é recalculada retroativamente.
- Filtros devem ser a única fonte para tabela, totais, gráfico e CSV. A ordenação inicial é data de venda decrescente.
- Manter foco visível, rótulos associados, regiões `aria-live`, contraste adequado, respeito a `prefers-reduced-motion` e zero overflow horizontal na página.

---

## File Structure

```text
controle-comissoes/
├── index.html                         # Estrutura semântica, formulários, cartões e tabela
├── style.css                           # Tokens, layout mobile-first, componentes e responsividade
├── app.js                              # Lógica pura, localStorage e eventos/renderização do DOM
├── tests/
│   └── app.test.js                     # Testes Node para cálculo, filtro, ordenação e CSV
├── docs/
│   ├── PRD.md                          # Requisitos aceitos
│   └── superpowers/
│       ├── specs/2026-09-07-controle-comissoes-design.md
│       └── plans/2026-09-07-controle-comissoes.md
└── README.md                           # Instruções de uso, dados locais e backup CSV
```

`app.js` expõe a camada pura via `module.exports` somente quando executado pelo Node. No navegador, ele carrega com `defer`, instala os eventos após `DOMContentLoaded` e não depende de `require`.

## Public Interfaces

```js
// app.js
const STORAGE_KEY = 'controle-comissoes.v1';

function createEmptyState() // => { sellers: [], commissions: [] }
function normalizeMoney(value) // string | number => number | NaN
function calculateCommission(saleValue, type, input) // => number
function filterCommissions(commissions, filters) // => Commission[]
function sortCommissions(commissions, field, direction) // => Commission[]
function buildCommissionCsv(commissions) // => string com BOM UTF-8
function formatCurrency(value) // number => string pt-BR/BRL
function todayLocal() // => "YYYY-MM-DD"
```

```js
// Objetos persistidos
// Seller: { id, name, contact, createdAt }
// Commission: {
//   id, sellerId, sellerName, product, saleValue, commissionType,
//   commissionInput, commissionValue, saleDate, note, createdAt, updatedAt
// }
```

### Task 1: Estruturar o documento, estilo base e o núcleo testável

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `app.js`
- Create: `tests/app.test.js`

**Interfaces:**
- Produces: `createEmptyState`, `normalizeMoney`, `calculateCommission`, `filterCommissions`, `sortCommissions`, `buildCommissionCsv`, `formatCurrency` e `todayLocal` exportadas no Node.
- Produces: `window.CommissionLogic` com as mesmas funções no navegador para depuração manual sem bibliotecas.

- [ ] **Step 1: Criar o teste inicial de normalização, cálculo e data local**

Em `tests/app.test.js`, criar os testes abaixo antes de `app.js` existir:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMoney,
  calculateCommission,
  todayLocal,
} = require('../app.js');

test('normaliza formatos brasileiros e decimais', () => {
  assert.equal(normalizeMoney('1.234,56'), 1234.56);
  assert.equal(normalizeMoney('1234,56'), 1234.56);
  assert.equal(normalizeMoney('1234.56'), 1234.56);
  assert.ok(Number.isNaN(normalizeMoney('abc')));
});

test('calcula comissão percentual e fixa', () => {
  assert.equal(calculateCommission(1500, 'percentage', 8), 120);
  assert.equal(calculateCommission(1500, 'fixed', 225), 225);
});

test('gera data local no formato de campo date', () => {
  assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Executar o teste e confirmar a falha inicial**

Run: `node --test tests/app.test.js`

Expected: falha `Cannot find module '../app.js'` porque o núcleo ainda não foi criado.

- [ ] **Step 3: Criar o esqueleto HTML semântico**

Criar `index.html` com idioma pt-BR, viewport, título `Controle de Comissões`, descrição de que os dados permanecem neste navegador, região global de avisos e a ordem de scripts clássicos. A estrutura mínima deve ser:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Controle local de comissões de vendedores.">
    <title>Controle de Comissões</title>
    <link rel="stylesheet" href="style.css">
    <script src="app.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <header class="site-header"><div class="container"><p class="eyebrow">Gestão comercial</p><h1>Controle de Comissões</h1></div></header>
    <main id="conteudo" class="container" tabindex="-1">
      <p id="app-message" class="app-message" role="status" aria-live="polite" hidden></p>
    </main>
  </body>
</html>
```

- [ ] **Step 4: Implementar a camada pura e a exportação condicional**

Criar `app.js` com constantes e funções puras. Para o dinheiro, remover `R$` e espaços, tratar simultaneamente ponto e vírgula como formato brasileiro, e retornar `NaN` em entrada inválida. Para evitar arredondamento visual, arredondar o resultado da comissão a dois decimais.

```js
const STORAGE_KEY = 'controle-comissoes.v1';

function normalizeMoney(value) {
  const text = String(value ?? '').trim().replace(/R\$|\s/g, '');
  if (!text) return Number.NaN;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function calculateCommission(saleValue, type, input) {
  const sale = Number(saleValue);
  const amount = Number(input);
  if (!Number.isFinite(sale) || !Number.isFinite(amount)) return Number.NaN;
  const result = type === 'percentage' ? sale * amount / 100 : amount;
  return Math.round((result + Number.EPSILON) * 100) / 100;
}

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

const CommissionLogic = { STORAGE_KEY, normalizeMoney, calculateCommission, todayLocal, formatCurrency };
if (typeof window !== 'undefined') window.CommissionLogic = CommissionLogic;
if (typeof module !== 'undefined' && module.exports) module.exports = CommissionLogic;
```

- [ ] **Step 5: Criar os tokens CSS e a proteção contra overflow**

Criar `style.css` com `box-sizing: border-box` global, cores neutras de alto contraste, tipografia de sistema, foco visível, `.container { width: min(100% - 2rem, 1180px); margin-inline: auto; }`, escala de espaçamento de 8px e a regra de movimento reduzido abaixo. Não definir largura fixa de página ou remover contornos de foco.

```css
:root {
  --bg: #f5f7f8;
  --surface: #ffffff;
  --text: #17212b;
  --muted: #52606d;
  --primary: #0f766e;
  --danger: #b42318;
  --border: #d0d7de;
  --radius: 12px;
  --shadow: 0 8px 24px rgb(23 33 43 / 8%);
}
* { box-sizing: border-box; }
html { color-scheme: light; }
body { min-width: 0; margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
:focus-visible { outline: 3px solid #f59e0b; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 6: Executar os testes verdes e a validação de sintaxe**

Run: `node --test tests/app.test.js && node --check app.js`

Expected: os três subtestes passam e `node --check` encerra com código 0.

- [ ] **Step 7: Commit da base**

```bash
git add index.html style.css app.js tests/app.test.js
git commit -m "feat: add commission app foundation"
```

### Task 2: Persistência validada e cadastro de vendedores

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- Consumes: `createEmptyState`, `CommissionLogic`, `formatCurrency` e `todayLocal` da Task 1.
- Produces: `loadState(storage)`, `saveState(storage, state)`, `validateSeller(input)`, `sellerHasCommissions(state, sellerId)` e `renderSellers()`.

- [ ] **Step 1: Acrescentar testes de estado e validação de vendedor**

Adicionar ao arquivo de testes:

```js
const { createEmptyState, sanitizeState, validateSeller, sellerHasCommissions } = require('../app.js');

test('normaliza estado corrompido em coleções vazias', () => {
  assert.deepEqual(sanitizeState({ sellers: 'erro', commissions: null }), createEmptyState());
});

test('exige nome para cadastrar vendedor', () => {
  assert.deepEqual(validateSeller({ name: '   ', contact: '' }), { valid: false, error: 'Informe o nome do vendedor.' });
  assert.equal(validateSeller({ name: 'Ana', contact: 'ana@empresa.com' }).valid, true);
});

test('identifica vendedor com comissões vinculadas', () => {
  assert.equal(sellerHasCommissions({ commissions: [{ sellerId: 'v1' }] }, 'v1'), true);
  assert.equal(sellerHasCommissions({ commissions: [{ sellerId: 'v1' }] }, 'v2'), false);
});
```

- [ ] **Step 2: Executar os novos testes para observar a falha**

Run: `node --test tests/app.test.js`

Expected: falha por ausência das quatro funções adicionadas.

- [ ] **Step 3: Inserir a seção de vendedores no HTML**

Dentro de `<main>`, criar uma seção `id="vendedores"` com formulário `id="seller-form"`, campos `seller-name` e `seller-contact`, botão de salvar, botão `seller-cancel` inicialmente oculto e região `seller-error` com `aria-live="assertive"`. Depois do formulário, criar `<ul id="seller-list" class="seller-list" aria-label="Vendedores cadastrados"></ul>`. Rótulos devem dizer `Nome do vendedor` e `Telefone ou e-mail`.

- [ ] **Step 4: Implementar estado e funções de vendedor sem depender do DOM**

Adicionar funções ao núcleo e exportá-las:

```js
function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createEmptyState() { return { sellers: [], commissions: [] }; }

function sanitizeState(raw) {
  if (!raw || !Array.isArray(raw.sellers) || !Array.isArray(raw.commissions)) return createEmptyState();
  return { sellers: raw.sellers, commissions: raw.commissions };
}

function loadState(storage) {
  try { return sanitizeState(JSON.parse(storage.getItem(STORAGE_KEY) || 'null')); }
  catch { return createEmptyState(); }
}

function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function validateSeller({ name, contact }) {
  if (!String(name || '').trim()) return { valid: false, error: 'Informe o nome do vendedor.' };
  return { valid: true, value: { name: String(name).trim(), contact: String(contact || '').trim() } };
}

function sellerHasCommissions(state, sellerId) {
  return state.commissions.some((commission) => commission.sellerId === sellerId);
}
```

No controlador, usar `crypto.randomUUID()` quando disponível e fallback `Date.now().toString(36) + Math.random().toString(36).slice(2)`. O submit cria ou atualiza vendedor, salva, renderiza e limpa o formulário. Ao editar o nome de um vendedor, atualizar `sellerName` de cada comissão cujo `sellerId` seja igual ao vendedor editado, preservando o histórico legível. A exclusão chama `window.confirm`, mas quando `sellerHasCommissions` for verdadeiro mostra `Não é possível excluir este vendedor porque há comissões no histórico.` e não chama confirmação.

- [ ] **Step 5: Renderizar lista de vendedores de forma segura**

Implementar `renderSellers()` com `document.createElement`, `textContent` e ouvintes de clique para editar/excluir. Cada item apresenta nome, contato ou `Sem contato informado`, botão `Editar vendedor` e botão `Excluir vendedor`. Não interpolar conteúdo digitado em `innerHTML`.

- [ ] **Step 6: Estilizar o formulário e a lista de vendedores**

Adicionar `.panel`, `.field`, `.field-grid`, `.seller-list`, `.seller-item`, `.button`, `.button-secondary` e `.button-danger`. Em telas acima de 700px, `.field-grid` usa duas colunas; em telas menores, uma coluna. Os botões de ações devem quebrar linha, não aumentar a largura da tela.

- [ ] **Step 7: Rodar testes e verificar sintaxe**

Run: `node --test tests/app.test.js && node --check app.js`

Expected: todos os subtestes passam e a checagem de sintaxe retorna código 0.

- [ ] **Step 8: Commit do cadastro de vendedores**

```bash
git add index.html style.css app.js tests/app.test.js
git commit -m "feat: add seller management"
```

### Task 3: Formulário de comissão, cálculo e edição

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- Consumes: `normalizeMoney`, `calculateCommission`, `todayLocal`, `state.sellers`, `saveState` e `renderSellers`.
- Produces: `validateCommission(input, sellers)`, `createCommission(input, now)`, `renderCommissionForm()` e `updateCommissionPreview()`.

- [ ] **Step 1: Escrever os testes de validação e registro**

```js
const { validateCommission, createCommission } = require('../app.js');

const sellers = [{ id: 'v1', name: 'Ana' }];

test('valida campos obrigatórios da comissão', () => {
  assert.deepEqual(validateCommission({ sellerId: '', saleValue: '10', commissionType: 'fixed', commissionInput: '2' }, sellers), {
    valid: false,
    error: 'Selecione um vendedor.'
  });
  assert.equal(validateCommission({ sellerId: 'v1', saleValue: '0', commissionType: 'fixed', commissionInput: '2' }, sellers).valid, false);
});

test('cria comissão percentual com valor congelado e nome histórico', () => {
  const commission = createCommission({ sellerId: 'v1', product: 'Plano', saleValue: '2.000,00', commissionType: 'percentage', commissionInput: '7,5', saleDate: '2026-09-07', note: '' }, sellers, '2026-09-07T12:00:00.000Z');
  assert.equal(commission.sellerName, 'Ana');
  assert.equal(commission.commissionValue, 150);
  assert.equal(commission.saleValue, 2000);
});
```

- [ ] **Step 2: Executar testes e confirmar a falha**

Run: `node --test tests/app.test.js`

Expected: falha por `validateCommission` e `createCommission` não exportadas.

- [ ] **Step 3: Construir o formulário acessível de comissão**

Adicionar antes da seção de vendedores uma seção `id="comissoes"` com formulário `id="commission-form"` e campos:

```html
<select id="commission-seller" name="sellerId" required></select>
<input id="commission-product" name="product" type="text" autocomplete="off">
<input id="commission-sale-value" name="saleValue" inputmode="decimal" required>
<select id="commission-type" name="commissionType"><option value="percentage">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select>
<input id="commission-input" name="commissionInput" inputmode="decimal" required>
<input id="commission-date" name="saleDate" type="date" required>
<textarea id="commission-note" name="note" rows="3"></textarea>
```

Incluir `<output id="commission-preview">Informe os valores para calcular a comissão.</output>`, região de erro `commission-error`, botão `Salvar comissão` e botão `Cancelar edição` oculto até editar um registro. Na inicialização e ao cancelar a edição, preencher `commission-date` com `todayLocal()`. Quando não houver vendedores, desabilitar o formulário e mostrar `Cadastre um vendedor antes de registrar uma comissão.`

- [ ] **Step 4: Implementar criação, validação e prévia**

Implementar `validateCommission` com mensagens exatas para vendedor inexistente, venda inválida, tipo inválido, comissão inválida e data vazia. `createCommission` obtém o vendedor, normaliza valores, calcula `commissionValue`, usa `seller.name`, gera identificador e define `createdAt`/`updatedAt`.

```js
function validateCommission(input, sellers) {
  const seller = sellers.find((item) => item.id === input.sellerId);
  if (!seller) return { valid: false, error: 'Selecione um vendedor.' };
  const saleValue = normalizeMoney(input.saleValue);
  if (!(saleValue > 0)) return { valid: false, error: 'Informe um valor de venda maior que zero.' };
  if (!['percentage', 'fixed'].includes(input.commissionType)) return { valid: false, error: 'Selecione um tipo de comissão válido.' };
  const commissionInput = normalizeMoney(input.commissionInput);
  if (!(commissionInput > 0)) return { valid: false, error: 'Informe uma comissão maior que zero.' };
  if (!input.saleDate) return { valid: false, error: 'Informe a data da venda.' };
  return { valid: true, value: { seller, saleValue, commissionInput } };
}

function createCommission(input, sellers, now = new Date().toISOString()) {
  const validation = validateCommission(input, sellers);
  if (!validation.valid) return null;
  const { seller, saleValue, commissionInput } = validation.value;
  const commissionValue = calculateCommission(saleValue, input.commissionType, commissionInput);
  return {
    id: createId(), sellerId: seller.id, sellerName: seller.name,
    product: String(input.product || '').trim(), saleValue,
    commissionType: input.commissionType, commissionInput, commissionValue,
    saleDate: input.saleDate, note: String(input.note || '').trim(),
    createdAt: now, updatedAt: now,
  };
}
```

No navegador, atualizar a prévia no evento `input` de venda/valor e no evento `change` de tipo. Sempre usar `formatCurrency` para mostrar o resultado; se inválido, manter a orientação inicial.

- [ ] **Step 5: Conectar criação e edição ao estado**

No submit, se `editingCommissionId` estiver vazio inserir a comissão criada; caso contrário preservar `id` e `createdAt`, atualizar o restante e definir novo `updatedAt`. Depois de salvar, chamar `saveState`, `renderAll`, focar o título da seção e informar `Comissão salva.`. Ao editar, preencher o formulário com valores persistidos, revelar cancelar e mudar o texto do botão para `Salvar alterações`.

- [ ] **Step 6: Aplicar estilos de prévia e campos inválidos**

Adicionar `.commission-preview`, `.error-message`, `.is-invalid` e `.form-actions`. A prévia precisa apresentar valor legível em tela pequena, sem depender somente de cor para indicar erro ou cálculo válido.

- [ ] **Step 7: Rodar os testes e checagem de sintaxe**

Run: `node --test tests/app.test.js && node --check app.js`

Expected: todos os testes existentes e os dois novos passam.

- [ ] **Step 8: Commit do registro de comissões**

```bash
git add index.html style.css app.js tests/app.test.js
git commit -m "feat: add commission registration"
```

### Task 4: Histórico filtrado, edição/exclusão e resumo

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- Consumes: `state.commissions`, `state.sellers`, `formatCurrency`, `saveState`, `renderCommissionForm`.
- Produces: `filterCommissions`, `sortCommissions`, `summarizeCommissions`, `renderHistory`, `renderSummary` e `renderChart`.

- [ ] **Step 1: Criar testes de filtros, ordenação e resumo**

```js
const { filterCommissions, sortCommissions, summarizeCommissions } = require('../app.js');

const history = [
  { id: 'c1', sellerId: 'v1', sellerName: 'Ana', saleDate: '2026-09-01', saleValue: 100, commissionValue: 10 },
  { id: 'c2', sellerId: 'v2', sellerName: 'Bruno', saleDate: '2026-09-05', saleValue: 300, commissionValue: 45 },
  { id: 'c3', sellerId: 'v1', sellerName: 'Ana', saleDate: '2026-09-10', saleValue: 200, commissionValue: 20 },
];

test('combina filtro de vendedor e período inclusivo', () => {
  assert.deepEqual(filterCommissions(history, { sellerId: 'v1', startDate: '2026-09-02', endDate: '2026-09-10' }).map((item) => item.id), ['c3']);
});

test('ordena cópia por comissão sem alterar a lista original', () => {
  const sorted = sortCommissions(history, 'commissionValue', 'desc');
  assert.deepEqual(sorted.map((item) => item.id), ['c2', 'c3', 'c1']);
  assert.equal(history[0].id, 'c1');
});

test('calcula total e subtotal por vendedor', () => {
  assert.deepEqual(summarizeCommissions(history), { total: 75, count: 3, bySeller: [{ sellerId: 'v2', sellerName: 'Bruno', total: 45 }, { sellerId: 'v1', sellerName: 'Ana', total: 30 }] });
});
```

- [ ] **Step 2: Executar os testes e confirmar a falha**

Run: `node --test tests/app.test.js`

Expected: falha por ausência de `filterCommissions`, `sortCommissions` e `summarizeCommissions`.

- [ ] **Step 3: Adicionar filtros, cartões e tabela ao HTML**

Criar seção `id="historico"` com filtros `filter-seller`, `filter-start-date` e `filter-end-date`, botão `Limpar filtros`, botão `Exportar CSV` e região `filter-error`. Criar cartões com `id="summary-total"`, `summary-count` e `summary-sellers`. Criar tabela com cabeçalho e botões de ordenação: `Vendedor`, `Produto ou serviço`, `Valor da venda`, `Valor da comissão`, `Data` e `Ações`; o corpo deve ser `id="commission-table-body"`. Envolver a tabela em `.table-scroll` e incluir legenda visual para a ordenação atual.

- [ ] **Step 4: Implementar filtros, ordenação e resumo sem DOM**

Implementar filtros inclusivos comparando strings `YYYY-MM-DD`; ignorar o filtro que estiver vazio. Se início for posterior ao fim, o controlador exibe `A data inicial não pode ser posterior à data final.` e não altera o último resultado válido.

```js
function filterCommissions(commissions, { sellerId = '', startDate = '', endDate = '' }) {
  return commissions.filter((item) =>
    (!sellerId || item.sellerId === sellerId) &&
    (!startDate || item.saleDate >= startDate) &&
    (!endDate || item.saleDate <= endDate)
  );
}

function summarizeCommissions(commissions) {
  const totals = new Map();
  for (const item of commissions) {
    totals.set(item.sellerId, {
      sellerId: item.sellerId,
      sellerName: item.sellerName,
      total: (totals.get(item.sellerId)?.total || 0) + item.commissionValue,
    });
  }
  return {
    total: commissions.reduce((sum, item) => sum + item.commissionValue, 0),
    count: commissions.length,
    bySeller: [...totals.values()].sort((a, b) => b.total - a.total || a.sellerName.localeCompare(b.sellerName, 'pt-BR')),
  };
}
```

`sortCommissions` deve operar em cópia, comparar texto com `localeCompare('pt-BR')`, números numericamente e data lexicalmente. A direção padrão inicial é `saleDate`/`desc`; novo clique no mesmo campo inverte direção.

- [ ] **Step 5: Renderizar histórico, edição e exclusão**

`renderHistory()` obtém dados somente por `getVisibleCommissions()`, que aplica `filterCommissions` e `sortCommissions`. Células usam `textContent`; produto vazio aparece como `—`. Cada linha cria botões `Editar comissão` e `Excluir comissão`. Excluir só prossegue se `window.confirm('Excluir esta comissão? Esta ação não pode ser desfeita.')` retornar verdadeiro; em seguida salva e renderiza. A lista vazia deve apresentar uma linha com `Nenhuma comissão encontrada para os filtros atuais.`.

- [ ] **Step 6: Renderizar cartões e gráfico de barras acessível**

`renderSummary()` usa exatamente `getVisibleCommissions()` e `summarizeCommissions()`. `renderChart()` cria uma lista `<ul id="commission-chart">`; para cada vendedor, a barra recebe `style.width = `${percentage}%`` e o texto `Ana: R$ 30,00`. Quando não houver dados, renderizar `Sem comissões no período selecionado.`. Nunca representar o valor apenas pelo tamanho ou pela cor da barra.

- [ ] **Step 7: Estilizar tabela, cartões e gráfico**

Adicionar grid de `.summary-grid` com no mínimo uma coluna e três colunas a partir de 900px. A tabela usa `min-width` somente dentro de `.table-scroll { overflow-x: auto; }`; o corpo da página continua sem overflow. Estilizar `.chart-bar-fill` com largura controlada, transição somente fora de `prefers-reduced-motion` e contraste visível.

- [ ] **Step 8: Rodar testes e verificação de sintaxe**

Run: `node --test tests/app.test.js && node --check app.js`

Expected: todos os testes passam e não há erro de sintaxe.

- [ ] **Step 9: Commit do histórico e resumo**

```bash
git add index.html style.css app.js tests/app.test.js
git commit -m "feat: add commission history and summaries"
```

### Task 5: CSV, mensagens de falha e documentação de uso

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `tests/app.test.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `getVisibleCommissions`, `formatCurrency`, `todayLocal`, `saveState`.
- Produces: `buildCommissionCsv`, `downloadCsv`, `showMessage` e `showFormError`.

- [ ] **Step 1: Escrever teste de CSV com caracteres brasileiros e escape de aspas**

```js
const { buildCommissionCsv } = require('../app.js');

test('gera CSV com BOM, ponto e vírgula e campos escapados', () => {
  const csv = buildCommissionCsv([{
    sellerName: 'Ana', product: 'Plano; Premium', saleValue: 1200,
    commissionValue: 120, saleDate: '2026-09-07', note: 'Disse "ok"'
  }]);
  assert.ok(csv.startsWith('\uFEFFVendedor;Produto ou serviço;Valor da venda;Valor da comissão;Data;Observação'));
  assert.match(csv, /"Plano; Premium"/);
  assert.match(csv, /"Disse ""ok"""/);
});
```

- [ ] **Step 2: Executar o teste e confirmar a falha inicial**

Run: `node --test tests/app.test.js`

Expected: falha por ausência de `buildCommissionCsv`.

- [ ] **Step 3: Implementar serialização e download no navegador**

Implementar funções abaixo e exportar somente `buildCommissionCsv`:

```js
function escapeCsv(value) {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCommissionCsv(commissions) {
  const header = ['Vendedor', 'Produto ou serviço', 'Valor da venda', 'Valor da comissão', 'Data', 'Observação'];
  const rows = commissions.map((item) => [
    item.sellerName, item.product, formatCurrency(item.saleValue),
    formatCurrency(item.commissionValue), item.saleDate, item.note,
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`;
}

function downloadCsv(content, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
```

O listener de `Exportar CSV` usa a lista visível e nome `comissoes-${todayLocal()}.csv`. Se não houver registros filtrados, não inicia download e mostra `Não há comissões para exportar com os filtros atuais.`.

- [ ] **Step 4: Centralizar mensagens e falhas de armazenamento**

Implementar `showMessage(text, type)` para atualizar `#app-message` e `showFormError(element, text)` para atualizar a região correspondente. Todo `saveState` no controlador deve estar em `try/catch`; se o armazenamento lançar, mostrar `Não foi possível salvar os dados neste navegador.` e manter o formulário preenchido para nova tentativa. O HTML adiciona classe visual para mensagens `success`, `error` e `info`, mas mantém o texto explícito.

- [ ] **Step 5: Criar o README para uso sem conhecimentos técnicos**

Criar `README.md` com estas seções: `Como abrir`, `Como cadastrar vendedores`, `Como registrar e editar comissões`, `Filtros e exportação`, `Onde os dados ficam`, `Como fazer backup` e `Como apagar todos os dados`. Explicar que os dados só ficam neste navegador/dispositivo, que o CSV é a cópia de segurança e como abrir `index.html` por duplo clique. Não alegar sincronização, login ou recuperação de exclusões.

- [ ] **Step 6: Rodar testes, sintaxe e verificação do conteúdo gerado**

Run: `node --test tests/app.test.js && node --check app.js && git diff --check`

Expected: todos os testes passam, JavaScript está sintaticamente válido e não há espaço em branco inválido no diff.

- [ ] **Step 7: Commit da exportação e documentação**

```bash
git add app.js index.html style.css tests/app.test.js README.md
git commit -m "feat: add CSV export and user guide"
```

### Task 6: Verificação completa no navegador e revisão de aceite

**Files:**
- Modify only if corrections are required: `index.html`, `style.css`, `app.js`, `tests/app.test.js`, `README.md`

**Interfaces:**
- Consumes: aplicação completa e o checklist em `docs/PRD.md`.
- Produces: evidências de testes, sintaxe, servidor local, fluxo real de CRUD, persistência, exportação e responsividade.

- [ ] **Step 1: Executar a suíte final e a validação estática**

Run: `node --test tests/app.test.js && node --check app.js && git diff --check && git status --short`

Expected: testes passam, sintaxe válida, sem erro de whitespace e somente arquivos intencionalmente não commitados aparecem no status.

- [ ] **Step 2: Iniciar servidor estático no diretório correto**

Run em processo de fundo com `workdir` igual à raiz do projeto:

```bash
python -m http.server 4173 --bind 127.0.0.1
```

Verificar cada recurso:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/index.html
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/style.css
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/app.js
```

Expected: três respostas `200`.

- [ ] **Step 3: Validar fluxo real pelo navegador**

Abrir `http://127.0.0.1:4173/` e executar, nesta ordem:

1. Cadastrar `Ana` com contato `ana@exemplo.com`.
2. Cadastrar `Bruno` sem contato.
3. Registrar para Ana: produto `Plano Mensal`, venda `2.000,00`, percentual `7,5`, data `2026-09-07`; confirmar prévia e tabela em `R$ 150,00`.
4. Registrar para Bruno: produto vazio, venda `800`, valor fixo `90`, data `2026-09-06`; confirmar tabela e resumo total em `R$ 240,00`.
5. Filtrar Ana de `2026-09-07` a `2026-09-07`; confirmar somente uma linha e total de `R$ 150,00`.
6. Editar a comissão de Ana para percentual `10`; confirmar valor de `R$ 200,00` e total filtrado atualizado.
7. Acionar exclusão de Bruno e cancelar a confirmação; confirmar que a linha continua. Repetir e aceitar; confirmar que a linha some.
8. Tentar excluir Ana enquanto houver comissão; confirmar a mensagem de bloqueio.
9. Recarregar a página; confirmar que Ana e a comissão de `R$ 200,00` continuam.
10. Limpar filtros e acionar CSV; confirmar que há tentativa de download com nome `comissoes-YYYY-MM-DD.csv`.

- [ ] **Step 4: Medir responsividade e acessibilidade no navegador**

Em viewport desktop e em 390px de largura, verificar:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

Expected: `0` nas duas larguras. Confirmar com inspeção do DOM que inputs têm `label[for]`, erros possuem região `aria-live` e botões de ação possuem nomes acessíveis distintos.

- [ ] **Step 5: Corrigir qualquer falha encontrada e repetir o cenário afetado**

Para cada falha, primeiro adicionar um teste Node quando a causa for lógica pura, executar para observar a falha, aplicar a menor correção e rodar toda a suíte. Para falha visual/interativa, corrigir o arquivo responsável e repetir exatamente o passo do navegador que falhou antes de repetir o fluxo completo.

- [ ] **Step 6: Fazer o commit de estabilização, se houve correção**

Somente se algum arquivo foi modificado nesta tarefa:

```bash
git add index.html style.css app.js tests/app.test.js README.md
git commit -m "fix: stabilize commission control flows"
```

- [ ] **Step 7: Capturar a evidência final e encerrar o servidor**

Capturar uma imagem da tela com vendedores e comissões reais de teste, manter o caminho para entrega e encerrar o processo do servidor. Executar `git status --short` depois disso.

Expected: estado de trabalho limpo, salvo arquivos de evidência que não devam entrar no repositório.

## Spec Coverage Review

| Requisito do PRD | Tarefa que o cobre |
|---|---|
| Cadastro, edição e exclusão de vendedores | Task 2 |
| Comissão percentual/fixa, data padrão e observação | Task 3 |
| Persistência local e falha de armazenamento | Tasks 2 e 5 |
| Tabela, filtros, ordenação, edição e exclusão | Task 4 |
| Total geral, por vendedor e gráfico | Task 4 |
| CSV e confirmação de exclusão | Tasks 4 e 5 |
| Responsividade, acessibilidade e fluxo real | Tasks 1, 2, 3, 4 e 6 |
| Documentação e backup local | Task 5 |

## Plan Self-Review

- Cobertura: cada requisito obrigatório e cada extra simples do PRD está associado a pelo menos uma tarefa.
- Consistência: os nomes de funções exportadas e os campos persistidos são definidos em `Public Interfaces` e reutilizados sem variações nas tarefas.
- Escopo: não há backend, autenticação, dependências ou sincronização fora do que foi aprovado.
- Verificação: cada núcleo lógico começa com teste que falha, passa após implementação e termina com checagem de sintaxe; a Task 6 valida a experiência real no navegador.
