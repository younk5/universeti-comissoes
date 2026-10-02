# PRD — Galaxy Smart: Controle de Comissões Multiusuário

**Status:** contrato de runtime vigente
**Versão:** 2.1

## 1. Visão geral

Galaxy Smart é uma aplicação web para administrar vendedores e suas comissões. A API Express em Node.js é a única camada de autorização e regra de negócio; Supabase Auth mantém identidades e PostgreSQL mantém os dados protegidos. O navegador opera somente contra a API same-origin e não acessa Supabase, tabelas, RPCs ou Auth diretamente.

Este documento descreve o contrato do runtime no código. Ele não declara que uma configuração, migration ou deploy de produção já foi executado.

A base Supabase autorizada começa vazia. Não existe migração de dados da versão local, de `localStorage`, de retiradas ou de backups antigos.

## 2. Decisões confirmadas

| Tema | Decisão |
|---|---|
| Hospedagem | Build Vite para `dist` e funções Node.js `api/[...path].js` e `api/health.js`, compatíveis com a configuração Vercel autorizada |
| Identidade | Supabase Auth com e-mail/senha |
| Banco de dados | PostgreSQL do Supabase, acessado somente pelos clientes de servidor protegidos |
| Perfis | `admin` e `seller` |
| Login | Um campo aceita e-mail ou nome de usuário; a senha é validada pelo Supabase Auth |
| Comissão | Status `pending`, `paid` ou `voided`; produto de catálogo prevalece sobre a regra padrão global |
| Base inicial | PostgreSQL Supabase vazio, sem importação ou migração dos dados locais |
| Vendedor com histórico | Não é excluído destrutivamente; é desativado e o histórico é preservado |
| Interface | Responsiva, em pt-BR e com identidade Galaxy Smart |

## 3. Personas e permissões

### Administrador comercial

Gerencia vendedores, registra e corrige comissões, marca pagamentos e acompanha totais e exportações.

### Vendedor

Entra na própria carteira, consulta somente as próprias comissões e troca a própria senha. Não cria, altera ou paga comissões.

| Operação | Admin | Seller ativo | Seller desativado |
|---|---:|---:|---:|
| Criar, editar ou desativar vendedor | Sim | Não | Não |
| Redefinir senha de vendedor | Sim | Não | Não |
| Criar, editar ou excluir comissão | Sim | Não | Não |
| Marcar comissão como paga, inclusive em lote | Sim | Não | Não |
| Ver todas as comissões, totais e CSV administrativo | Sim | Não | Não |
| Ver a própria carteira | Não aplicável | Sim | Não |
| Trocar a própria senha | Sim | Sim | Não |

A API verifica token Supabase, perfil, papel e estado ativo em cada rota. Ocultar uma ação no front-end não é controle de segurança.

## 4. Escopo funcional

### MUST — obrigatório

| ID | História | Critérios de aceite |
|---|---|---|
| F01 | Entrar por e-mail ou usuário | Um identificador único aceita e-mail ou nome de usuário; respostas de credencial inválida, perfil ausente ou conta inativa permanecem genéricas. |
| F02 | Administrar vendedores | Admin cria, edita, redefine senha e desativa vendedores. Nome, e-mail e usuário são obrigatórios; usuário normalizado é único; senha inicial/redefinida observa o piso efetivo de 6 caracteres imposto pelo Supabase GoTrue hospedado. |
| F03 | Preservar histórico | Vendedor sem histórico pode ser excluído. Vendedor com comissões não pode ser removido destrutivamente: a ação correta é desativar a conta e revogar acesso. |
| F04 | Registrar comissão | Admin informa vendedor, produto de catálogo opcional ou texto manual, venda, data e observação. Produto ativo de catálogo usa sua regra; item manual usa a comissão padrão global configurada. O navegador envia somente dados operacionais e a API/RPC seleciona e persiste o snapshot da regra. |
| F05 | Controlar pagamento | Comissão começa em `pending`; ação individual ou em lote altera somente registros pendentes selecionados para `paid` e grava `paidAt`. |
| F06 | Consultar e filtrar | Filtros de vendedor, período e status atualizam tabela, cartões, gráfico, seleção em lote e CSV de modo consistente. |
| F07 | Ver carteira isolada | Seller vê apenas sua carteira: a receber (`pending`), já recebido (`paid`) e extrato em leitura. |
| F08 | Exportar CSV | Admin baixa CSV UTF-8 com BOM para o conjunto filtrado. |
| F09 | Fazer bootstrap seguro | Script local cria somente o primeiro `admin` em base autorizada e vazia; não imprime senha ou chave privada. |

### Fora de escopo

- Recuperação de senha por e-mail, cadastro público e permissões adicionais.
- Pagamento automático, recibos ou cálculo de impostos.
- Exclusão destrutiva de vendedor que possua histórico.
- Importação de planilhas, dados locais, retiradas ou backups antigos.
- Leitura/escrita direta de Supabase pelo cliente.

## 5. Modelo de dados

### `profiles`

```text
id, role ('admin' | 'seller'), display_name, username, username_normalized,
phone, active, session_not_before, created_at, updated_at, archived_at
```

`profiles.username_normalized` tem unicidade no PostgreSQL e permanece normalizado em minúsculas. Nenhuma regra financeira pertence ao perfil do vendedor nem ao contrato público.

### `products`

```text
id, name, active, commission_type ('percentage' | 'fixed'),
commission_rate_bps | commission_fixed_cents, created_at, updated_at
```

Um produto ativo de catálogo tem uma regra individual. Ao criar ou editar uma comissão com `product_id`, essa regra autorizada é a fonte do snapshot e prevalece sobre a comissão padrão global.

### `commission_default_rule`

```text
id (singleton true), configured, commission_type ('percentage' | 'fixed'),
commission_rate_bps | commission_fixed_cents, updated_at
```

A única regra global é obrigatória para uma comissão sem `product_id`. Enquanto `configured` não for verdadeiro, a API recusa lançamento manual com erro acionável para configuração em **Produtos**. A alteração da regra recalcula somente comissões `pending` sem produto de catálogo.

### `commissions`

```text
id, seller_id, seller_name_snapshot, product_id (nulo para item manual), product,
sale_value_cents, commission_type ('percentage' | 'fixed'),
commission_rate_bps | commission_fixed_cents, commission_value_cents,
sale_date ('YYYY-MM-DD'), status ('pending' | 'paid' | 'voided'), paid_at,
note, created_at, updated_at
```

O produto, vendedor e regra aplicada ficam gravados como snapshots históricos. A alteração de regra de produto só recalcula pendências daquele produto; a alteração da regra global só recalcula pendências sem `product_id`. Comissões pagas, anuladas e vinculadas a produto não são alteradas pela regra global.

## 6. Arquitetura e segurança

> **Runtime vigente.** Esta seção é a referência para a operação do aplicativo e seus limites de acesso.

```text
Navegador
  ├─ access token somente em memória
  └─ refresh token no cookie host-only HttpOnly, Secure e SameSite=Strict
                                  ↓ HTTPS / API do mesmo domínio
                         Express na Vercel
                                  ↓ clientes de servidor
                    Supabase Auth + PostgreSQL
                         └─ RLS deny-all e grants restritos
```

- O navegador chama somente a API Express same-origin; ele não recebe `SUPABASE_SERVICE_ROLE_KEY`, não estabelece cliente Supabase e não acessa tabelas, RPCs ou Auth diretamente. O access token retornado pela API fica apenas em memória. O refresh token fica no cookie de produção `__Host-galaxy-smart-refresh`, com `Path=/`, sem atributo `Domain` (host-only), `HttpOnly`, `Secure` e `SameSite=Strict`.
- A API é a única camada de regra de negócio e autorização. Em cada requisição autenticada, ela valida o token com Supabase Auth e exige uma sessão não revogada em `app_session_registry`, um perfil ativo e `session_not_before` compatível com a emissão do token.
- Supabase Auth mantém as identidades de e-mail/senha. PostgreSQL mantém `profiles`, com os papéis `admin` e `seller`, as comissões, os lotes/eventos de pagamento, o registro de sessões e o bloqueio de bootstrap. `profiles.id` referencia `auth.users.id`.
- As tabelas do esquema público têm RLS habilitada e forçada, sem políticas permissivas: o comportamento para `PUBLIC`, `anon` e `authenticated` é deny-all. Os grants de tabelas e as execuções de RPC são concedidos explicitamente apenas a `service_role`.
- `SUPABASE_SERVICE_ROLE_KEY` existe exclusivamente nas variáveis protegidas das funções Vercel. `SUPABASE_URL` e a chave publicável são usadas pelos clientes de servidor sem persistir sessão; a service role não é enviada ao navegador, versionada ou registrada em log. Senhas de bootstrap, tokens e outros segredos também não são versionados nem registrados.
- Valores monetários são representados em centavos (`bigint` no PostgreSQL), taxas percentuais em pontos-base e cálculos no JavaScript usam `BigInt`; não se usa ponto flutuante para calcular comissões. O banco calcula e armazena o valor percentual a partir de centavos e pontos-base.
- O navegador pode mostrar uma prévia de regra recebida da API, mas não escolhe autoridade financeira: `POST` e `PATCH` de comissão aceitam somente `sellerId`, `productId` opcional, texto manual de produto, `saleValue`, `saleDate` e `note`. Campos como `commissionType`, `commissionInput`, taxa, valor fixo ou valor de comissão enviados pelo navegador são rejeitados. Em edição, `productId: null` é a transição explícita de produto de catálogo para item manual; sem essa propriedade, o servidor preserva o produto já vinculado.
- As transições financeiras protegidas são RPCs atômicas e auditáveis: `mark_commissions_paid` transforma somente comissões `pending` em `paid`, cria um lote e eventos de pagamento; `void_commission` transforma somente uma comissão `pending` em `voided`, também com lote e evento. Ambas são executáveis somente por `service_role` através da API.
- A API aplica CSP e cabeçalhos de segurança; `vercel.json` protege também os arquivos estáticos entregues pela Vercel. O contrato de produção usa Node.js 22+, Vite para gerar `dist` estático, funções `api/*.js` para `/api/*` e `api/health.js` para saúde. Somente `/health` é reescrito para `/api/health`; não há rewrite amplo para uma página SPA. `server.js` e `express.static()` ficam restritos à verificação local.

## 7. Fluxos essenciais

1. A pessoa informa e-mail ou nome de usuário e senha. A API normaliza e resolve o identificador sem enumerar e-mails, autentica com Supabase Auth e exige `profiles.active = true`. A resposta mantém o access token somente em memória e grava o refresh token no cookie protegido; falhas de credencial, perfil ausente ou conta inativa permanecem genéricas.
2. Em login ou refresh, a API registra a sessão de aplicação identificada no token. Nas chamadas seguintes, ela bloqueia token sem sessão ativa, perfil ausente/inativo ou emitido antes de `session_not_before`; logout remove o cookie e invalida a sessão aplicável.
3. Admin cria ou edita vendedor pela API. A criação cria a identidade no Supabase Auth e o respectivo `profiles` com papel `seller`; falha ao gravar o perfil compensa a identidade recém-criada. Papel, unicidade normalizada e estado ativo são definidos no servidor.
4. Admin registra ou altera uma comissão ainda `pending`. A API valida o vendedor ativo e os dados operacionais. Com `productId`, a RPC bloqueia o produto ativo e usa sua regra; sem produto, a RPC bloqueia a regra padrão global configurada e usa seu snapshot. A API não aceita regra, taxa, valor fixo ou valor de comissão escolhidos pelo navegador. PostgreSQL persiste o cálculo sem conversão por ponto flutuante; seller ativo recebe somente as comissões cujo `seller_id` é o próprio perfil.
5. Admin marca uma ou mais comissões pendentes como pagas pela RPC atômica `mark_commissions_paid`; a carteira e os totais passam a refletir os registros `paid` e o lote/evento auditável. A anulação administrativa usa `void_commission` e preserva o registro como `voided`, em vez de apagar o histórico.
6. Admin desativa vendedor com histórico. A API marca o perfil inativo, avança `session_not_before`, revoga as sessões abertas em `app_session_registry` e bloqueia a identidade no Supabase Auth. Ações e refresh posteriores são recusados, enquanto perfis, comissões e eventos permanecem preservados.

## 8. Requisitos não funcionais

- Node.js 22 ou superior, JavaScript ESM, Express, Vite, Supabase e Vercel.
- API retorna erros por campo para `400`, autenticação para `401`, autorização/conta inativa para `403`, inexistência para `404` e conflitos para `409`; erros inesperados não expõem stack trace, tokens, chaves ou detalhes internos.
- O navegador opera somente pelo mesmo domínio da API, com CSP `connect-src 'self'`. Access token não é persistido em armazenamento web; refresh token usa cookie host-only, `HttpOnly`, `Secure` e `SameSite=Strict` em produção. Sessões de aplicação são revogáveis por registro de sessão e por `session_not_before`.
- PostgreSQL armazena valores em centavos, taxas em pontos-base e aplica limites e integridade de status (`pending`, `paid`, `voided`). A regra individual do produto tem precedência; a regra padrão global é usada apenas sem produto e seus snapshots ficam nas comissões. A aplicação calcula e formata com `BigInt`; valores exibidos usam `pt-BR` / BRL e datas usam `YYYY-MM-DD`.
- RLS é deny-all para clientes: `PUBLIC`, `anon` e `authenticated` não recebem acesso a tabelas nem a RPCs. Somente o serviço protegido na Vercel usa `service_role`; nenhum cliente recebe essa chave.
- Desktop e celular funcionam sem rolagem horizontal; controles têm rótulo, foco visível e mensagens legíveis.
- Testes unitários e de API verificam cálculo em centavos/pontos-base, cookie de sessão, autenticação, autorização, conta desativada, revogação de sessão, isolamento de seller e a ausência de acesso direto a dados. Testes e operações atuais não dependem de Emulator Suite.
- Migrations Supabase são aplicadas de forma ordenada antes do bootstrap e antes de validar produção. O banco Supabase começa vazio, sem migração de `localStorage`, retiradas ou backups antigos; criar projeto/configurar Supabase ou Vercel continua sendo decisão explícita e autorizada do usuário.

## 9. Critérios de conclusão

- [ ] As migrations Supabase necessárias estão aplicadas no projeto autorizado, incluindo tabelas, constraints, RLS forçada, revogação de grants de cliente e grants/RPCs exclusivos de `service_role`.
- [ ] Admin e seller entram por e-mail e por nome de usuário pela API same-origin; access token fica somente em memória e refresh token usa cookie host-only `HttpOnly`, `Secure` e `SameSite=Strict`.
- [ ] A API aceita somente sessão de aplicação não revogada, perfil ativo, papel autorizado e token emitido após `session_not_before`; logout, redefinição de senha e desativação invalidam o acesso conforme aplicável.
- [ ] Admin administra vendedores e comissões; seller não altera dados financeiros nem acessa tabelas ou RPCs Supabase diretamente.
- [ ] Valores em centavos, pontos-base e `BigInt` preservam cálculo e exibição em BRL sem ponto flutuante; `pending`, `paid` e `voided` controlam carteira e totais administrativos.
- [ ] Pagamento em lote e anulação usam RPCs atômicas, registram lote/evento auditável e não apagam histórico financeiro.
- [ ] A regra padrão global e as regras individuais de catálogo são aplicadas somente por RPCs; lançamentos manuais sem regra configurada são recusados e payloads do navegador não determinam valores financeiros.
- [ ] Vendedor com histórico é desativado, tem identidade e sessões bloqueadas, e mantém perfis, comissões e eventos preservados.
- [ ] O banco Supabase autorizado começa vazio e nenhum dado local é migrado; o bootstrap controlado cria somente o primeiro admin em banco vazio, sem imprimir senha ou chave de serviço.
- [ ] A Vercel está configurada com build, funções, cabeçalhos e variáveis Supabase protegidas; a service role não é exposta ao navegador.
- [ ] Um deploy real autorizado foi validado contra a Vercel configurada, incluindo `/health`, autenticação same-origin, restrição de RLS/grants e fluxos administrativos essenciais.
- [ ] Testes, build, auditoria de segredos e `git diff --check` foram executados antes de qualquer publicação autorizada.
