# Universe TI — Regra padrão de comissão

## Objetivo

Centralizar a comissão de itens sem regra individual em uma única configuração administrativa. Um produto cadastrado, por exemplo `Cabo HDMI`, aplica sempre sua regra própria. Qualquer outro produto ou serviço digitado manualmente aplica a regra padrão global. Nenhuma regra de comissão depende do vendedor.

## Escopo aprovado

- A aba **Produtos** terá uma seção **Comissão padrão** acima do catálogo.
- A regra padrão aceita exatamente uma modalidade: `fixed` (centavos) ou `percentage` (pontos-base).
- O catálogo continua permitindo regra individual por produto ativo; a regra individual sempre prevalece.
- Comissão sem produto de catálogo usa obrigatoriamente a regra padrão global.
- A regra padrão pode ser criada ou alterada no site por administrador ativo.
- Ao salvar a regra padrão, todas as comissões `pending` com `product_id IS NULL` são recalculadas na mesma transação.
- Comissões `paid`, `voided` e com `product_id` preenchido não são recalculadas pela regra padrão.
- O campo **Percentual padrão** sai do cadastro, edição, listagem, contrato público, metadados técnicos e banco de vendedores.
- Os campos **Tipo de comissão** e **Percentual ou valor** saem do cadastro e da edição de comissão. O navegador não escolhe nem envia a regra financeira.

## Fluxo de lançamento

O formulário de comissão terá vendedor, produto do catálogo opcional, produto ou serviço manual, valor da venda, data e observação.

1. Ao selecionar um produto ativo do catálogo, o servidor aplica a regra daquele produto e usa o nome do catálogo como snapshot.
2. Sem produto de catálogo, o administrador informa somente o texto do produto ou serviço; o servidor aplica a regra padrão global.
3. Enquanto a regra padrão não estiver configurada, lançamentos sem produto de catálogo são recusados com uma mensagem explícita para configurá-la em **Produtos**.
4. A interface pode mostrar uma prévia baseada na regra recebida da API, mas envia somente dados operacionais. O servidor e as funções PostgreSQL são a autoridade.
5. Editar uma comissão pendente reaplica a regra correspondente ao produto selecionado ou, sem produto de catálogo, a regra padrão global.

## Dados e concorrência

Uma migration cria a tabela privada singleton `public.commission_default_rule`:

| Campo | Regra |
| --- | --- |
| `id` | sempre `true`; única linha bloqueável |
| `configured` | começa `false`; somente `true` habilita lançamentos sem catálogo |
| `commission_type` | nulo quando não configurada; `fixed` ou `percentage` quando configurada |
| `commission_rate_bps` | obrigatório somente para percentual |
| `commission_fixed_cents` | obrigatório somente para valor fixo |
| `updated_at` | horário da última alteração |

A migration insere a única linha ainda não configurada. Ela também cria `public.commission_default_rule_events` para registrar ator, regra anterior, regra nova, data e quantidade de pendências recalculadas.

A função PostgreSQL `update_default_commission_rule` será `SECURITY DEFINER`, terá `search_path` explícito, bloqueará a linha singleton com `FOR UPDATE`, atualizará a regra e recalculará somente pendências sem produto. Uma função distinta `upsert_default_backed_commission` bloqueará a mesma linha antes de criar ou editar uma comissão sem catálogo. Assim, uma mudança de regra e um lançamento manual não podem gravar snapshots conflitantes.

O fluxo de produtos continua usando `upsert_product_backed_commission`, que bloqueia o produto selecionado. A criação ou edição de comissão nunca usa inserção ou atualização direta para definir `commission_type`, taxa ou valor fixo.

A migration remove `profiles.default_commission_rate_bps` e a chave técnica correspondente de `auth.users.raw_user_meta_data`, pois a comissão não é mais uma propriedade do vendedor.

## API

As rotas de catálogo existentes permanecem compatíveis. A API adiciona, somente para administrador ativo:

- `GET /api/commission-default-rule` — retorna a regra configurada ou `null`.
- `PUT /api/commission-default-rule` — recebe somente `commissionType` e `commissionInput`; valida centavos/pontos-base, persiste com RPC e retorna a quantidade de pendências recalculadas.

Os endpoints de vendedores não aceitam nem retornam `defaultCommissionRate`. Os endpoints de comissão rejeitam campos de regra originados pelo navegador e aceitam somente a identidade opcional de produto, texto do produto, vendedor, venda, data e observação.

## Interface

### Produtos

- Exibir **Comissão padrão para itens sem regra individual** antes do formulário do catálogo.
- Permitir selecionar `Percentual` ou `Valor fixo`, preencher um valor e salvar.
- Informar após a alteração quantas comissões pendentes sem produto cadastrado foram recalculadas.
- Manter os formulários e ações de regra individual do catálogo.

### Vendedores

- Remover o campo de percentual padrão do formulário.
- Remover a coluna percentual padrão da tabela.
- Nenhuma tela de vendedor exibe ou edita regra financeira.

### Comissões

- Remover os controles de tipo e valor de comissão.
- Produto de catálogo continua opcional; o texto manual fica disponível para itens fora do catálogo.
- A prévia identifica se a regra vem do produto selecionado ou da comissão padrão.
- Produto selecionado desativado não pode ser usado em lançamento novo.

## Segurança e invariantes

- Tabelas, eventos e RPCs da regra padrão não recebem acesso de `PUBLIC`, `anon` ou `authenticated`; apenas `service_role` executa a camada protegida.
- Todas as operações exigem administrador ativo na API e novamente nas RPCs críticas.
- Valores são inteiros: centavos para dinheiro e pontos-base para percentual. Não há ponto flutuante como fonte de verdade.
- Regras aplicadas permanecem gravadas em cada comissão como snapshot histórico.
- A mudança da regra padrão não afeta produto com regra individual, pagamento concluído ou comissão anulada.
- Nenhum identificador de produto, modalidade ou valor transmitido pelo navegador prevalece sobre a regra autorizada pelo servidor.

## Verificação

- Testes de migration verificam singleton, RLS, grants, RPCs, locks, recálculo pendente e remoção da taxa por vendedor.
- Testes de domínio/serviço/API verificam regra padrão fixa e percentual, ausência de configuração, concorrência por RPC, autorização e rejeição de campos financeiros enviados pelo navegador.
- Testes de interface verificam seção padrão, remoção dos campos solicitados, prévia, estados de carregamento e recálculo informado.
- Antes de publicar: suíte completa, verificação estática, build, inspeção visual desktop/mobile e aplicação confirmada da migration em Production.
