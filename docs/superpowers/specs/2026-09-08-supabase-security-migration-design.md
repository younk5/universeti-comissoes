# Migração Segura para Supabase — Galaxy Smart

**Data:** 2026-09-08  
**Status:** desenho aprovado para especificação; implementação depende da revisão deste arquivo.  
**Escopo:** substituir Firebase Authentication e Firestore por Supabase Auth + PostgreSQL no Galaxy Smart, preservando a experiência atual de administração e portal de vendedor.

## 1. Objetivo e limites

O Galaxy Smart passará a operar como aplicação multiusuário hospedada, com papéis `admin` e `seller`, dados financeiros consistentes, isolamento por vendedor e trilha de auditoria de pagamentos.

A aplicação manterá Vite no cliente, Express na API e Vercel na hospedagem. O Supabase será usado como provedor de identidade e PostgreSQL hospedado na região `sa-east-1` (São Paulo), no plano gratuito enquanto o uso estiver dentro das cotas do plano.

O banco começa vazio. Não haverá importação de `localStorage`, Firebase, retiradas ou comissões legadas. A branch `feat/multiuser-platform` permanece preservada; a migração acontece em `feat/supabase-platform`.

Fora de escopo:

- criar um novo desenho visual ou alterar os fluxos de negócio já aprovados;
- expor tabelas do Supabase diretamente no navegador;
- criar múltiplos administradores, pagamentos externos, PIX ou integração bancária;
- publicar antes de banco, autenticação, variáveis e primeiro administrador estarem validados;
- armazenar segredos, refresh tokens, senhas, dumps ou connection strings no Git.

## 2. Alternativas avaliadas e decisão

### A. Supabase direto no navegador com RLS

O cliente usaria `supabase-js` para autenticação e consultas. Reduz código no Express, mas amplia a superfície pública: URL, chave publicável, consultas, regras e comportamento de token ficam no navegador. Também torna o login por nome de usuário e a revogação de sessões mais difíceis de controlar.

### B. Supabase mediado pela API Express — decisão

O navegador chama somente a origem da própria aplicação. A API Express autentica o usuário no Supabase, valida o token em cada operação e executa os acessos a PostgreSQL com a chave administrativa confinada à Vercel. O navegador não recebe a chave de serviço, não abre conexão com o Supabase e não consulta tabelas.

Essa opção conserva a arquitetura que já separava frontend e regras financeiras, permite cookies seguros para refresh e simplifica auditoria, rate limiting futuro e validação de papéis.

### C. Permanecer no Firebase

A implementação anterior era viável, mas a configuração real está bloqueada por permissões Google/IAM e Firestore é menos natural para registros financeiros relacionais. Esta opção foi descartada.

## 3. Arquitetura final

```text
Navegador
  └─ HTTPS same-origin ──> Express na Vercel
       ├─ autenticação de senha e refresh ──> Supabase Auth
       └─ regra de negócio e transações ───> Supabase PostgreSQL

Supabase PostgreSQL
  ├─ RLS habilitado e forçado em todas as tabelas públicas
  ├─ nenhuma política para anon/authenticated
  └─ funções mutáveis executáveis apenas por service_role
```

### 3.1 Fronteiras de responsabilidade

| Componente | Responsabilidade | Não pode fazer |
|---|---|---|
| Navegador | Interface, access token temporário em memória, chamadas HTTPS para a API | acessar tabelas, guardar refresh token, decidir papel ou calcular autorização |
| Express/Vercel | autenticar, renovar sessão, validar token e papel, aplicar regras de negócio, serializar dados | expor `SUPABASE_SERVICE_ROLE_KEY` ou confiar em papel vindo do cliente |
| Supabase Auth | armazenar credenciais, emitir e renovar tokens | autorizar consultas de negócio sem a API |
| PostgreSQL | integridade, índices, RLS, transações e eventos de pagamento | aceitar acesso público por padrão |

### 3.2 Fluxo de sessão

1. O formulário envia `identifier` (e-mail ou nome de usuário) e senha para `POST /api/auth/login`.
2. A API normaliza o identificador. Para nome de usuário, procura somente no servidor o e-mail associado ao perfil ativo; para e-mail, usa o próprio e-mail.
3. A API executa `signInWithPassword` no Supabase Auth, confirma que o usuário autenticado corresponde ao perfil ativo e devolve apenas `accessToken`, expiração e ator serializado.
4. A API grava o refresh token rotativo em cookie HTTP-only. Em produção o cookie usa o prefixo `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` e não define `Domain`. Em desenvolvimento local, usa o mesmo contrato sem o atributo `Secure` para permitir HTTP em `localhost`.
5. O cliente mantém o access token somente em memória. Na recarga ou expiração, chama `POST /api/auth/refresh`; a API lê o cookie, rotaciona a sessão, atualiza o cookie e devolve um novo access token.
6. Toda chamada autenticada usa `Authorization: Bearer <access token>`. Ao receber `401`, o cliente tenta uma única renovação coordenada e repete a solicitação uma vez; falha de renovação limpa a sessão e volta ao login.
7. `POST /api/auth/logout` invalida a sessão quando há token, limpa o cookie em qualquer caso e devolve `204` sem conteúdo.

A API devolve erro de credencial inválida sem distinguir e-mail inexistente, usuário inexistente, senha errada ou conta bloqueada. Respostas de autenticação usam `Cache-Control: no-store`.

### 3.3 Senhas, desativação e revogação

- Troca de senha exige a senha atual, autentica essa senha no Supabase Auth e então atualiza a credencial pelo cliente administrativo.
- Reset administrativo gera uma senha temporária somente pela API e a devolve uma única vez ao administrador autenticado pela resposta HTTPS; ela não entra em logs, erros, banco, CSV ou respostas posteriores.
- `profiles.session_not_before` é atualizado em toda troca/reset de senha, logout global e desativação. Após `getUser(token)` confirmar a assinatura, a API compara o `iat` do JWT com esse limite; token anterior é recusado mesmo que ainda não tenha expirado.
- Desativar vendedor marca `active = false`, atualiza `session_not_before` e aplica banimento no Supabase Auth. Reativar remove o banimento, mas exige novo login.
- A API nunca usa `user_metadata` ou JWT como fonte de verdade do papel. Papel e status vêm de `profiles` a cada requisição autenticada.

## 4. Modelo de dados PostgreSQL

Todos os identificadores de negócio usam UUID. Todos os timestamps usam `timestamptz`. Valores financeiros são inteiros em centavos; porcentagens são inteiros em pontos-base (`1050` representa `10,50%`). O limite de valores impede ultrapassar o intervalo inteiro seguro do JavaScript quando convertido para a resposta.

### 4.1 Tipos

- `app_role`: `admin`, `seller`.
- `commission_type`: `percentage`, `fixed`.
- `commission_status`: `pending`, `paid`, `voided`.
- `payment_event_type`: `paid`, `voided`.

### 4.2 Tabelas

#### `profiles`

| Coluna | Regra |
|---|---|
| `id uuid` | chave primária e referência a `auth.users(id)`; não apagada por fluxo normal |
| `email text` | cópia normalizada para lookup interno; única em minúsculas |
| `username text` | nome visível |
| `username_normalized text` | minúsculo e único; usado no login por nome de usuário |
| `display_name text` | nome exibido na interface |
| `role app_role` | `admin` ou `seller` |
| `active boolean` | padrão `true`; vendedor desativado mantém histórico |
| `session_not_before timestamptz` | limite de revogação de token |
| `created_at`, `updated_at` | auditoria temporal |

A aplicação cria somente vendedores depois do bootstrap. Um índice parcial garante, no escopo inicial, no máximo um perfil `admin`; uma ampliação futura para vários administradores exigirá migração explícita e revisão de segurança.

#### `commissions`

| Coluna | Regra |
|---|---|
| `id uuid` | chave primária |
| `seller_id uuid` | referência restrita a `profiles` |
| `seller_name_snapshot text` | preserva o nome no momento do lançamento |
| `product text` | obrigatório e limitado |
| `sale_value_cents bigint` | maior que zero |
| `commission_type commission_type` | percentual ou fixa |
| `commission_rate_bps integer` | obrigatório somente para percentual |
| `commission_fixed_cents bigint` | obrigatório somente para valor fixo |
| `commission_value_cents bigint` | coluna gerada pelo banco, com arredondamento em centavos |
| `status commission_status` | padrão `pending` |
| `paid_at timestamptz` | obrigatório somente quando `status = paid` |
| `created_at`, `updated_at` | auditoria temporal |

As restrições `CHECK` impedem combinações inválidas de tipo, percentual e valor fixo. A fórmula do valor de comissão é gerada no PostgreSQL: percentual usa `(sale_value_cents * commission_rate_bps + 5000) / 10000`, com arredondamento para o centavo mais próximo; valor fixo usa `commission_fixed_cents`. A API envia apenas os dados de entrada e nunca recebe um valor de comissão arbitrário do cliente.

A carteira não é tabela de saldo. Ela é uma consulta derivada de comissões pendentes e pagas, evitando divergência entre um saldo armazenado e os lançamentos que o formam.

#### `payment_batches` e `commission_payment_events`

`payment_batches` registra uma operação de pagamento em lote: identificador, administrador executor e instante. `commission_payment_events` é append-only e registra comissão, lote, estado anterior, estado novo, executor e instante.

Uma função PostgreSQL recebe os UUIDs das comissões, atualiza somente registros `pending`, cria o lote somente quando há atualização e insere um evento para cada registro efetivamente pago. Tudo ocorre em uma única transação. Repetir a mesma chamada não cria novo evento nem duplica pagamento porque o `UPDATE` filtra por `status = 'pending'`.

#### `bootstrap_locks`

Tabela de controle para impedir corrida na criação do primeiro administrador. O bootstrap adquire uma reivindicação com expiração, cria o usuário no Supabase Auth, insere o perfil `admin` e libera a reivindicação. Em falha de perfil, exclui o usuário Auth recém-criado. A trava e o índice parcial de administrador evitam dois primeiros administradores concorrentes.

## 5. Proteção do banco

1. Cada tabela pública recebe `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.
2. Não haverá policy permissiva para `anon` nem `authenticated`; o acesso direto pelo Data API é negação total.
3. Privilégios em tabelas e funções mutáveis são revogados de `PUBLIC`, `anon` e `authenticated`.
4. A função de pagamento define `SET search_path = public`, recebe parâmetros tipados, não concatena SQL e é concedida somente a `service_role`.
5. A API usa `service_role` apenas depois de validar o token e recarregar o perfil. A chave nunca aparece em `VITE_*`, arquivos estáticos, logs, respostas, exceções ou testes.
6. Consultas usam colunas explícitas, nunca `select('*')` para respostas externas.
7. Exclusão de vendedores é desativação. Comissão paga não é apagável; eventual anulação gera evento `voided`, preservando o histórico.

RLS é uma defesa adicional importante, mas não substitui a autorização da API: a chave de serviço ignora RLS e por isso fica exclusivamente no servidor protegido.

## 6. API e serviços

A superfície pública continua same-origin, sob `/api`.

| Grupo | Rotas e regra |
|---|---|
| Sessão | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/password`; respostas sem cache e erro genérico de login |
| Identidade | `GET /me`; token válido, perfil ativo e papel carregado do banco |
| Administração de sellers | listar, criar, editar, desativar, reativar e resetar senha; somente `admin`; senha temporária aparece uma única vez na resposta autenticada |
| Comissões | criar, listar com filtros, editar pendente, anular, CSV e marcar pagas em lote; `seller` sempre recebe filtro forçado para o próprio `seller_id` |
| Saúde | `GET /health`; não revela configuração, banco, versão ou segredos |

Os módulos serão separados por responsabilidade:

- `supabase-admin.js`: constrói clientes server-side sem estado de sessão persistido.
- `session-service.js`: login, refresh, logout, cookie e leitura de actor.
- `auth-middleware.js`: extrai Bearer token, chama `getUser`, confere `iat`, perfil ativo e papel.
- `user-service.js`: administração de perfil e Auth, com compensação na falha parcial.
- `commission-service.js`: valida entradas em centavos/pontos-base, mapeia linhas PostgreSQL e invoca a transação de pagamento.
- `session-client.js`: token efêmero no navegador, deduplicação de refresh e limpeza local.

## 7. Configuração, segredos e provisionamento

### 7.1 Variáveis de runtime

A Vercel terá, somente no ambiente Production:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` somente durante o bootstrap inicial, removidas imediatamente depois

`SUPABASE_PUBLISHABLE_KEY` é usada apenas pelo servidor para chamadas de senha/refresh. Nenhuma variável Supabase é injetada no bundle Vite. A validação de configuração exige URL HTTPS de domínio Supabase, chaves não vazias e proíbe variáveis Firebase antigas.

`.env.local`, `.vercel/`, dumps e logs de CLI permanecem ignorados. `.env.example` mostra apenas nomes e valores de exemplo sem segredo. O scanner de segredos bloqueia commits com chaves, tokens, senhas, JWTs, connection strings ou dumps.

### 7.2 Projeto Supabase

O projeto será criado no plano gratuito, região `sa-east-1`, com nome `galaxy-smart`. A autenticação pública por cadastro será desativada: usuários entram apenas por bootstrap ou criação administrativa. A conta da CLI exige login interativo do titular; caso a ferramenta encontre login, senha, 2FA ou consentimento, essa etapa é entregue ao usuário e nenhuma credencial é solicitada, exibida ou digitada pelo agente.

Migrations SQL ficam em `supabase/migrations/`, são aplicadas com a CLI vinculada ao project ref e passam pelo linter SQL antes do deploy. A senha administrativa do banco não é necessária no runtime da aplicação e não é armazenada em `.env` ou Vercel.

### 7.3 Vercel e política de conteúdo

O projeto Vercel existente `galaxy-smart` será reutilizado. Não haverá variável Supabase em Preview até existir ambiente isolado para preview; builds podem ocorrer, mas rotas que exijam configuração falharão fechadas em vez de consultar produção.

Como o navegador fala somente com a própria origem, a CSP de produção conserva `connect-src 'self'` e `img-src 'self'`. Não será liberado `*.supabase.co` no navegador.

## 8. Operação e recuperação

O plano gratuito deve ser usado apenas enquanto as cotas e as garantias operacionais forem adequadas. Antes de operar valores reais, o administrador executará um export de recuperação em armazenamento controlado pelo usuário, verificará que pode restaurar o arquivo em ambiente separado e registrará a data do teste. O dump não entra no Git, Vercel nem diretório do projeto.

A documentação de operação incluirá:

- criação segura e remoção do primeiro admin;
- procedimento de desativação e reativação de seller;
- export/recuperação e teste de recuperação;
- rotação de `SUPABASE_SERVICE_ROLE_KEY` se houver suspeita de exposição;
- rollback de aplicação para a branch Firebase preservada sem tocar dados do Supabase;
- critérios para sair do plano gratuito: crescimento acima das cotas, necessidade de backup gerenciado, suporte ou exigência de alta disponibilidade.

## 9. Testes e critérios de aceite

A migração segue TDD. Cada novo comportamento recebe teste que falha antes da implementação e passa depois da alteração mínima.

### Testes automáticos

- configuração falha fechada sem variáveis Supabase, com URL inválida ou com variável Firebase;
- login aceita e-mail ou username sem enumerar contas;
- cookie de refresh não aparece em JSON, é `HttpOnly`, `SameSite=Strict` e `Secure` em produção;
- refresh rotaciona token e logout limpa a sessão;
- token anterior a `session_not_before` recebe `401`;
- seller não lê, exporta nem altera comissões de outro seller;
- admin cria, desativa, reativa e reseta vendedor; a senha temporária é visível uma única vez somente ao admin autenticado e nunca é registrada;
- conversão de moeda e taxa cobre arredondamento de centavo, valores inválidos e limites;
- pagamento em lote é idempotente e produz um único evento por comissão efetivamente paga;
- RLS, grants, função de pagamento, índices e constraints aparecem na migration verificada por testes de contrato;
- scanner garante ausência de Firebase no runtime e de segredos em arquivos rastreados;
- cliente renova uma única vez sob múltiplas chamadas `401`, sem corrida de refresh.

### Validação de banco e cloud

Antes do primeiro admin, uma execução cloud com guarda explícita só poderá ocorrer se o banco estiver confirmado vazio. Ela usa identidades e registros de teste com prefixo reservado, verifica isolamento e pagamento e remove integralmente esses registros antes do bootstrap. O script interrompe se encontrar qualquer perfil ou comissão não pertencente ao teste.

Antes de publicar: `npm test`, `npm run build`, `npm run check`, `npm run check:secrets`, `git diff --check`, lint das migrations e inspeção dos artefatos Vercel. Depois de publicar: leitura de `/health`, inspeção dos headers CSP e tentativa anônima de acesso que deve ser negada. A aplicação não será declarada pronta sem essas evidências e uma revisão independente da branch.

## 10. Riscos assumidos e mitigação

| Risco | Mitigação |
|---|---|
| Plano gratuito pausar projeto inativo ou não oferecer garantia operacional de backup | export e teste de recuperação antes de dados reais; reavaliar plano quando houver operação contínua |
| Chave de serviço exposta | chave apenas em Production, scanner, logs sem segredo, rotação documentada |
| Token válido após troca de senha | `session_not_before` é verificado pela API em toda requisição |
| Duplicidade de pagamento por retry | função transacional filtra pendentes e grava evento somente para linhas atualizadas |
| Cadastro ou leitura direta por API pública | sem policy permissiva de RLS, sem cliente Supabase no browser e cadastro público desativado |
| Configuração de conta Supabase exigir interação humana | agente prepara tudo localmente e para na barreira de autenticação/consentimento, sem adivinhar ou pedir credenciais |
