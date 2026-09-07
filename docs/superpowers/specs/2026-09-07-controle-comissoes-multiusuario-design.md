# Design — Controle de comissões multiusuário hospedado

**Data:** 07/09/2026  
**Status:** aprovado em conversa; aguardando revisão deste documento antes do plano de implementação  
**Produto:** Galaxy Smart

## 1. Objetivo

Transformar o controle local de comissões em uma aplicação web hospedada na Vercel, com autenticação separada para administração e vendedores, dados persistentes no Firebase e isolamento rigoroso dos dados de cada vendedor.

A versão hospedada substitui o uso contínuo de `localStorage` como fonte de verdade e inicia com banco de dados vazio. Registros do sistema local não serão transferidos.

## 2. Decisões confirmadas

| Tema | Decisão |
|---|---|
| Hospedagem | Vercel desde a primeira versão |
| Identidade e senha | Firebase Authentication com e-mail/senha |
| Banco | Cloud Firestore |
| Backend | Funções Node.js hospedadas na Vercel |
| Perfis | `admin` e `seller` |
| Identificador de login | Um campo aceita e-mail ou nome de usuário |
| Dados do sistema local | Não serão migrados; a base Firebase inicia vazia |
| Exclusão de vendedor com histórico | Bloqueada; o vendedor é desativado |
| Interface | Galaxy Smart, responsiva, em pt-BR |

## 3. Limites da primeira entrega

Incluído:

- Login por e-mail ou nome de usuário e senha.
- Painel administrativo e área de vendedor separados.
- Cadastro, edição, ativação, desativação e redefinição de senha de vendedores.
- Lançamento e filtragem de comissões.
- Status `pending` e `paid`, inclusive em lote.
- Carteira de vendedor somente leitura.
- CSV das comissões filtradas.
- Bootstrap seguro do primeiro administrador.
- Publicação preparada para Vercel + Firebase.

Fora de escopo:

- Recuperação de senha por e-mail.
- Pagamentos automáticos, emissão de recibos ou cálculo de impostos.
- Exclusão destrutiva de vendedor que possua histórico.
- Cadastro público de contas.
- Importação de dados locais ou planilhas externas.
- Funcionalidades de nuvem adicionais além de Firebase.

## 4. Arquitetura

### 4.1 Componentes

```text
Navegador
  ├── Front-end Galaxy Smart
  ├── Firebase Authentication (sessão do usuário)
  └── API do mesmo domínio
          │ token Firebase
          ▼
Vercel Node.js API
  ├── autenticação por nome de usuário
  ├── checagem de token, papel e conta ativa
  ├── operações administrativas
  └── consulta segura do vendedor
          │ Firebase Admin SDK
          ▼
Firebase
  ├── Authentication: credenciais e contas bloqueadas
  └── Cloud Firestore: usuários e comissões
```

O aplicativo será hospedado em um único domínio Vercel. O front-end não fará leituras nem escritas diretas no Firestore: dados de negócio passam pela API, que usa o Firebase Admin SDK. As regras do Firestore negarão acesso direto de clientes.

### 4.2 Front-end e API

O front-end continuará leve, com HTML, CSS e módulos JavaScript organizados por responsabilidade. Ele usa Firebase Authentication para manter a sessão do navegador e solicita a API com `Authorization: Bearer <token>`.

A API Node.js terá responsabilidades separadas:

- autenticação por identificador;
- middleware de sessão e autorização;
- usuários/vendedores;
- comissões e ações em lote;
- carteira e relatórios;
- exportação CSV;
- bootstrap administrativo.

As funções retornam JSON consistente e o front-end converte erros conhecidos em mensagens pt-BR próximas ao contexto da ação.

### 4.3 Autenticação por e-mail ou nome de usuário

Firebase Authentication usa e-mail e senha. Para aceitar nome de usuário no mesmo campo de login, a API recebe o identificador, resolve o nome de usuário internamente pelo índice privado e delega a autenticação ao Firebase sem expor listagens de e-mails.

O usuário recebe uma sessão Firebase válida. Para o restante das chamadas, a API verifica token, perfil no Firestore, papel e estado da conta. A autorização não depende apenas do que o front-end mostra.

Ao desativar um vendedor, a API:

1. marca o perfil como inativo;
2. desativa a conta no Firebase Authentication;
3. revoga tokens de atualização;
4. bloqueia qualquer nova requisição autenticada desse usuário.

### 4.4 Primeiro administrador

O repositório fornecerá um script de bootstrap executado localmente e de forma interativa ou com variáveis locais não versionadas. O script cria a primeira conta Firebase, o perfil `admin` no Firestore e o índice de nome de usuário.

A credencial administrativa do Firebase é usada somente em ambiente local/Vercel seguro. E-mail, senha, chave privada e token de configuração não são colocados em arquivos rastreados, variáveis públicas, logs ou documentação com valores reais.

## 5. Modelo de dados

### 5.1 `users/{uid}`

```js
{
  id: string,                 // mesmo valor de uid do Firebase Authentication
  role: 'admin' | 'seller',
  name: string,
  email: string,
  username: string,           // preserva a grafia escolhida
  usernameNormalized: string, // minúsculo e sem espaços externos
  phone: string,
  active: boolean,
  defaultCommissionRate: number | null,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  disabledAt: Timestamp | null
}
```

Vendedor não possui coleção separada: todo vendedor é um usuário cujo `role` é `seller`. Isso impede que um cadastro exista sem conta e evita mapeamentos duplicados.

### 5.2 `usernames/{usernameNormalized}`

```js
{
  uid: string,
  updatedAt: Timestamp
}
```

A coleção é manipulada exclusivamente pela API. A criação e a edição de nome de usuário usam transação para garantir unicidade sem diferenciar maiúsculas/minúsculas.

### 5.3 `commissions/{commissionId}`

```js
{
  sellerId: string,
  sellerName: string, // cópia histórica exibível
  product: string,
  saleValue: number,
  commissionType: 'percentage' | 'fixed',
  commissionInput: number,
  commissionValue: number,
  saleDate: 'YYYY-MM-DD',
  paymentStatus: 'pending' | 'paid',
  paidAt: Timestamp | null,
  note: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

O valor de comissão é calculado e persistido no lançamento. Alterar o percentual padrão de um vendedor não altera comissões passadas.

## 6. Permissões

| Operação | Admin | Vendedor ativo | Vendedor desativado |
|---|---:|---:|---:|
| Criar/editar/desativar vendedor | Sim | Não | Não |
| Redefinir senha de vendedor | Sim | Não | Não |
| Criar/editar/excluir comissão | Sim | Não | Não |
| Marcar comissões como pagas | Sim | Não | Não |
| Ver todas as comissões e totais | Sim | Não | Não |
| Exportar CSV administrativo | Sim | Não | Não |
| Ver a própria carteira e extrato | Não aplicável | Sim | Não |
| Trocar a própria senha | Sim | Sim | Não |

A API verifica essas regras para toda rota. O front-end apenas esconde ações que o perfil não deve usar; não é o controle de segurança.

## 7. Fluxos principais

### 7.1 Login

1. A pessoa informa e-mail ou nome de usuário e senha.
2. A API trata o identificador sem expor a base de usuários.
3. Firebase Authentication valida a senha hashada.
4. A API e o navegador confirmam que o perfil está ativo.
5. Admin vai para Administração; vendedor vai para Minha carteira.
6. Credencial inválida, perfil ausente ou conta inativa resultam em mensagem segura e genérica.

### 7.2 Administração de vendedores

1. Admin preenche nome, e-mail, nome de usuário, senha inicial, telefone opcional e percentual padrão opcional. Ao editar, senha em branco mantém a credencial atual; redefinição exige uma nova senha.
2. A API valida campos, cria a conta Firebase, cria `users` e reserva `usernames` em operação segura.
3. O vendedor pode trocar a senha após entrar.
4. Admin pode editar dados permitidos, redefinir senha ou desativar a conta.
5. Excluir definitivamente só é permitido sem comissões ou pagamentos históricos; caso contrário, a interface orienta a desativar.

### 7.3 Comissão e pagamento

1. Admin seleciona vendedor, informa venda e percentual ou valor fixo.
2. Front-end pré-calcula; API recalcula e valida antes de persistir.
3. O status inicial padrão é `pending`.
4. Uma ação individual ou em lote muda apenas comissões pendentes selecionadas para `paid` e grava `paidAt`.
5. Filtros por vendedor, data e status controlam tabela, totais, gráfico, seleção em lote e CSV.

### 7.4 Carteira do vendedor

- **A receber:** soma das comissões `pending` do vendedor filtradas pelo período quando aplicável.
- **Já recebido:** soma das comissões `paid` do vendedor.
- **Extrato:** comissão, venda, produto, data e status.
- O gráfico mensal exibe comissões pagas por mês.
- Toda consulta é limitada ao `uid` da sessão autenticada no servidor.

## 8. Telas

### Login

- Logo Galaxy Smart.
- Campo “E-mail ou usuário”.
- Campo de senha.
- Mensagens de validação e erro seguro.

### Administração

- Navegação lateral compacta: Resumo, Vendedores e Comissões.
- Cartões de pendente, pago e resumo por vendedor.
- Formulários com rótulos, foco visível e confirmação em ações irreversíveis.
- Tabela de comissões com filtros, seleção em lote, edição, exclusão e CSV.
- Detalhe de vendedor com comissões e totais.

### Minha carteira

- Nome do vendedor, botão de troca de senha e sair.
- Cartões A receber e Já recebido.
- Filtro de período, gráfico mensal e extrato somente leitura.

Em celular, as telas usam coluna única e controles que não geram rolagem horizontal. Em desktop, a navegação fixa melhora velocidade operacional.

## 9. Validação, erros e segurança

### Regras

- Nome, e-mail e nome de usuário são obrigatórios ao criar vendedor novo.
- E-mail é validado; nome de usuário normalizado é único.
- Senha inicial é obrigatória para criar uma conta; senha em edição é opcional somente quando a credencial atual deve ser mantida. Senhas inicial e redefinida exigem no mínimo 12 caracteres.
- Produto, telefone, observação e percentual padrão são opcionais.
- Valores financeiros devem ser positivos, finitos e aceitam vírgula ou ponto no front-end.
- `paymentStatus` aceita somente `pending` ou `paid`.
- Datas seguem `YYYY-MM-DD`; período inicial não pode ser posterior ao final.

### Tratamento de falhas

- Dados inválidos retornam `400` com erros por campo.
- Token ausente ou inválido retorna `401`.
- Papel insuficiente ou conta inativa retorna `403`.
- Recurso inexistente retorna `404`.
- Nome de usuário, e-mail e conflito de edição retornam `409`.
- Falha inesperada retorna `500` sem stack trace, segredo ou detalhe interno ao navegador.
- Login sempre apresenta uma mensagem genérica, independentemente de identificador inválido, senha inválida ou conta bloqueada.

### Proteções

- Firebase Admin SDK somente no servidor.
- Variáveis secretas apenas na Vercel e no ambiente local não rastreado.
- Firestore bloqueia acesso direto de client SDK.
- Requisições autenticadas enviam token no cabeçalho; API valida em cada chamada.
- Cabeçalhos de segurança e Content Security Policy restringem origens de scripts, conexões e frames.
- Nenhum registro de log contém senha, token, chave privada ou corpo sensível.

## 10. Testes e aceite

### Automação

1. Unitários para cálculo, filtros, normalização de identificador, validações e status.
2. Integração com Firebase Emulator para:
   - admin autorizado;
   - vendedor limitado à própria carteira;
   - vendedor desativado bloqueado;
   - nome de usuário único;
   - criação e redefinição de senha;
   - comissão individual/em lote.
3. Testes de rota para `401`, `403`, `404`, `409` e validações.
4. Teste de build local preparado para Vercel e auditoria para confirmar que segredos não foram rastreados.

### Navegador e implantação

1. Login por e-mail e por nome de usuário para ambos os papéis.
2. Verificação de isolamento dos dados do vendedor.
3. Fluxos de criação/desativação de vendedor e comissão paga/pendente.
4. CSV, filtros, gráfico, confirmações e mensagens de falha.
5. Desktop e viewport móvel sem rolagem horizontal.
6. Preview Vercel com Firebase de teste e, depois, produção com variáveis configuradas.

## 11. Configuração de produção

A documentação de implementação explicará a criação de projeto Firebase, ativação de Authentication por e-mail/senha e Firestore, geração da credencial administrativa, variáveis secretas da Vercel, bootstrap do primeiro administrador e processo de deploy.

Valores públicos de configuração Web do Firebase podem ser disponibilizados ao front-end. Credenciais administrativas, senha de bootstrap e dados privados permanecem apenas em variáveis protegidas. O repositório incluirá `.env.example` sem valores reais.

## 12. Critérios de conclusão

- Admin e vendedor entram por e-mail ou nome de usuário e veem somente o painel correto.
- Senhas nunca são salvas em texto no app, Firestore ou Git.
- Admin administra vendedores e comissões; vendedor não altera dados financeiros.
- Status pago/pendente controla os valores da carteira e os totais administrativos.
- A base Firebase inicia vazia, sem importar os dados do sistema local.
- Desativação bloqueia acesso e preserva histórico.
- Testes automatizados, browser real e preview publicado são verificados antes da entrega.
