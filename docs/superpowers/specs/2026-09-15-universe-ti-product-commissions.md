# Universe TI — Catálogo de produtos e comissões automáticas

## Objetivo

Adicionar um catálogo administrativo de produtos à plataforma Universe TI. Cada produto terá uma única regra própria de comissão — valor fixo em reais ou percentual sobre a venda — para reduzir preenchimento manual e preservar cálculo financeiro preciso.

## Escopo confirmado

- Administradores gerenciam produtos na nova aba **Produtos**.
- Um produto possui nome, tipo de regra (`fixed` ou `percentage`), valor da regra e estado ativo.
- Não existem grupos de produto.
- Ao lançar uma comissão, o administrador seleciona um produto ativo e a interface preenche a regra do catálogo.
- O administrador pode ajustar a regra somente para aquela comissão antes de criar o lançamento; a alteração não edita o catálogo.
- Alterar a regra no catálogo recalcula transacionalmente todas as comissões **pendentes** vinculadas àquele produto.
- Comissões pagas ou anuladas nunca são recalculadas.
- Produtos desativados não aparecem no lançamento de novas comissões; permanecem nos registros históricos.
- A regra aplicada fica congelada na própria comissão; o histórico não depende de uma leitura posterior do catálogo.

## Modelo de dados

Nova tabela privada `public.products`:

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | UUID | identificador interno |
| `name` | texto | único por normalização, 1–200 caracteres |
| `commission_type` | `public.commission_type` | `fixed` ou `percentage` |
| `commission_rate_bps` | bigint nulo | obrigatório somente para percentual |
| `commission_fixed_cents` | bigint nulo | obrigatório somente para valor fixo |
| `active` | boolean | padrão ativo |
| `created_at`, `updated_at` | timestamp com fuso | auditoria temporal |

A comissão passa a guardar `product_id` opcional, com chave estrangeira protegida. O campo textual `product` continua como snapshot legível para histórico e exportações. Lançamentos antigos permanecem compatíveis com `product_id = NULL`.

A tabela e suas rotinas não terão acesso de `anon`, `authenticated` ou `PUBLIC`; a API com `service_role` continua sendo a única camada de negócio.

## API administrativa

- `GET /api/products?includeInactive=false`: produtos públicos para a UI administrativa, sem dados internos.
- `POST /api/products`: cria produto ativo.
- `PATCH /api/products/:id`: edita nome/regra; se a regra mudar, recalcula pendentes em uma única transação e devolve o produto atualizado mais `recalculatedPendingCount`.
- `POST /api/products/:id/deactivate`: desativa logicamente; recusa se o produto já estiver inativo.
- `POST /api/products/:id/activate`: reativa produto existente.

Todas exigem administrador ativo. A API valida dinheiro em centavos e percentuais em pontos-base; nunca usa ponto flutuante como fonte de verdade.

## Recalcular pendências

A alteração de regra chama uma função PostgreSQL `SECURITY DEFINER`, com `search_path` explícito, criada por migration. Ela:

1. Confirma que o produto existe e está ativo.
2. Atualiza somente comissões com `status = 'pending'` e `product_id` correspondente.
3. Recalcula `commission_value_cents` no banco a partir de `sale_value_cents` e da nova regra, usando aritmética inteira e arredondamento final de centavo.
4. Atualiza em cada comissão o tipo/taxa/valor fixo aplicado como snapshot.
5. Registra um evento durável de auditoria por operação de regra, com produto, ator, regra anterior, regra nova, horário e quantidade de pendências recalculadas.
6. Retorna o produto atualizado e a quantidade calculada.

Mudança apenas de nome não recalcula valores. Pagas e anuladas são invariantes.

## Interface

### Aba Produtos

Após **Comissões**, nova aba **Produtos**:

- Formulário para criar ou editar: produto, comissão fixa/percentual e valor.
- Tabela com produto, regra, status, pendências afetadas na última alteração e ações editar/desativar/reativar.
- Desativar não apaga dados e não pede senha adicional; segue exigindo administrador autenticado.
- Alterar uma regra exibe confirmação clara: `As comissões pendentes deste produto serão recalculadas. Pagas e anuladas não serão alteradas.`

### Cadastro de comissão

- Produto vira `select` com catálogo ativo.
- A seleção preenche tipo e valor; a prévia financeira continua visível.
- Produtos de lançamentos antigos aparecem pelo snapshot de texto, mesmo desativados.
- A UI não calcula a regra como fonte de verdade: envia o produto e a API valida/reaplica a regra antes de persistir. A prévia é apenas informativa.

## Segurança e invariantes

- Vendedor não lê, cria, edita, desativa nem usa endpoint administrativo de produtos.
- Produto desativado é rejeitado para novas comissões.
- Uma comissão não pode receber `product_id` arbitrário sem a regra autorizada do servidor.
- Arquivamento/remoção é lógico, não físico.
- Produtos e eventos de alteração entram no backup administrativo; nenhuma informação de autenticação é exposta.

## Verificação

- Testes de migration validam RLS, grants, constraints, RPC `SECURITY DEFINER`, `search_path` e filtros pendentes.
- Testes de serviço/API validam criação, validação, autorização, seleção ativa, snapshot e recálculo seguro.
- Testes de view validam aba Produtos, seleção de catálogo, prévia, confirmação e estado de carregamento.
- Produção só recebe código após migration aplicada e confirmação no SQL Editor; validação não destrutiva confirma rotas administrativas autenticadas quando houver sessão segura disponível.
- Testes completos, check, build, detector visual, inspeção desktop/mobile e verificação de rotas de produção são obrigatórios antes de publicação.
