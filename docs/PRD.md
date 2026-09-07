# PRD — Controle de Comissões

**Status:** validado para especificação em 07/09/2026
**Versão:** 1.1

## 1. Visão geral

Aplicação web local para registrar vendedores e acompanhar comissões de vendas sem servidor. Deve abrir diretamente no navegador e manter os dados no `localStorage` do navegador.

## 2. Problema e objetivo

O usuário precisa registrar comissões de vários vendedores, consultar o histórico por pessoa e período, calcular corretamente percentuais e visualizar totais sem depender de planilhas ou de um backend.

**Objetivo principal:** inserir, revisar e exportar registros de comissão com poucos passos, em computador e celular.

## 3. Dados confirmados e pendentes

| Item | Situação | Decisão |
|---|---|---|
| Cadastro de vendedor | Confirmado | somente nome obrigatório |
| Registro de comissão | Confirmado | vendedor, venda, tipo/valor da comissão, data e observação |
| Persistência | Confirmado | `localStorage`, sem servidor |
| Relatórios | Confirmado | total geral, total por vendedor, gráfico simples |
| Exportação | Extra simples | CSV com os registros filtrados |
| Marca, logo e cores | Pendente | interface neutra e legível, sem marca inventada |
| Login, usuários e permissões | Fora de escopo | não haverá autenticação nesta versão |

## 4. Personas e trabalho a realizar

**Hipótese — administrador comercial:** registra uma venda ao ocorrer e precisa conferir quanto cada vendedor acumulou em determinado período.

> Quando registro uma venda, quero calcular e guardar a comissão correta para poder pagar e auditar os vendedores com segurança.

## 5. Escopo funcional

### MUST — obrigatório

| ID | História de usuário | Critérios de aceite |
|---|---|---|
| F01 | Cadastrar vendedor | O formulário bloqueia nome vazio, aceita somente o nome e atualiza a lista imediatamente. |
| F02 | Editar ou excluir vendedor | A edição atualiza o cadastro. A exclusão pede confirmação; se houver movimentações, o aviso informa que todas as comissões e retiradas vinculadas também serão apagadas. |
| F03 | Registrar comissão | Exige vendedor, valor de venda e tipo/valor de comissão. Produto e observação são opcionais. A data inicia no dia atual, mas pode ser alterada. |
| F04 | Calcular comissão percentual | Ao escolher percentual, o valor calculado é `valor da venda × percentual ÷ 100`; o valor persistido é o resultado calculado no momento do registro. |
| F05 | Registrar comissão fixa | Ao escolher valor fixo, o valor informado é salvo como valor da comissão, sem recálculo. |
| F06 | Consultar histórico | A tabela exibe vendedor, produto/serviço, venda, comissão e data; permite editar e excluir cada linha. |
| F07 | Filtrar | Filtros por vendedor, data inicial e data final podem ser combinados; lista, totais e exportação refletem o resultado filtrado. |
| F08 | Ver totais | Exibe total de comissão no filtro atual, saldo disponível geral e resumo por vendedor. |
| F09 | Persistir dados | Vendedores, comissões e retiradas continuam disponíveis após recarregar a página no mesmo navegador. |
| F10 | Responsividade e acessibilidade básica | Funciona em telas pequenas, com rótulos, foco visível, navegação por teclado e mensagens de erro legíveis. |
| F11 | Carteira por vendedor | Cada vendedor possui saldo próprio, calculado por comissões creditadas menos retiradas registradas para ele. A retirada exige vendedor, não pode ultrapassar o saldo e integra o histórico cronológico da carteira. |

### SHOULD — incluir nesta versão

| ID | História de usuário | Critérios de aceite |
|---|---|---|
| S01 | Exportar CSV | Baixa um CSV UTF-8 com BOM, contendo os registros atualmente filtrados. |
| S02 | Ordenar a tabela | Cabeçalhos de vendedor, data, venda e comissão alternam ordem crescente/decrescente. A ordem inicial é a venda mais recente. |
| S03 | Comparar vendedores visualmente | Gráfico de barras simples, sem bibliotecas externas, mostra comissão por vendedor no filtro atual. |

### WON'T — fora de escopo desta entrega

- Login, recuperação de senha, multiusuário ou permissões.
- Sincronização em nuvem, API ou banco de dados.
- Emissão de recibos, cálculo de impostos ou pagamento automático.
- Importação de planilhas.

## 6. Requisitos não funcionais

- Stack: HTML, CSS e JavaScript puro; sem build e sem dependências externas.
- A aplicação deve abrir por duplo clique em `index.html` ou via servidor estático local.
- Valores monetários são armazenados como números em reais e exibidos no formato `pt-BR` / BRL.
- Entradas numéricas aceitam vírgula ou ponto decimal, normalizadas antes do cálculo.
- O código não contém dados de exemplo persistentes, segredos ou chamadas de rede.
- O layout prioriza uma coluna em celular e duas colunas quando houver espaço no desktop.

## 7. Modelo de dados

```text
localStorage key: controle-comissoes.v1

{
  sellers: [{
    id: string,
    name: string,
    createdAt: ISO-8601
  }],
  commissions: [{
    id: string,
    sellerId: string,
    sellerName: string,
    product: string,
    saleValue: number,
    commissionType: "percentage" | "fixed",
    commissionInput: number,
    commissionValue: number,
    saleDate: "YYYY-MM-DD",
    note: string,
    createdAt: ISO-8601,
    updatedAt: ISO-8601
  }],
  withdrawals: [{
    id: string,
    sellerId: string,
    sellerName: string,
    value: number,
    withdrawalDate: "YYYY-MM-DD",
    note: string,
    createdAt: ISO-8601
  }]
}
```

`sellerName` é uma cópia histórica para a comissão continuar legível se dados antigos forem importados ou ficarem sem referência. A exclusão normal pelo app é bloqueada enquanto houver histórico ligado ao vendedor.

## 8. Fluxos e tratamento de erros

1. **Primeiro uso:** a área de comissões orienta a cadastrar um vendedor antes de permitir salvar uma venda.
2. **Nova comissão:** usuário escolhe vendedor, informa valor da venda e percentual ou valor fixo; o cálculo aparece antes de salvar.
3. **Carteiras:** cada comissão entra como crédito na carteira do vendedor. A carteira mostra saldo, totais e movimentações em ordem cronológica inversa.
4. **Retirada:** usuário seleciona o vendedor, informa valor e data; o sistema bloqueia valores maiores que o saldo daquela carteira.
5. **Edição:** o registro existente preenche o mesmo formulário; salvar atualiza em vez de duplicar, sem permitir que uma carteira fique negativa.
6. **Filtros:** qualquer alteração atualiza tabela, cartões, gráfico e conjunto exportado.
7. **Erros:** campos obrigatórios vazios, números inválidos, valores negativos, retirada maior que o saldo da carteira e período invertido apresentam mensagens específicas próximas ao formulário.
8. **Exclusões:** vendedor, comissão ou retirada pedem confirmação nativa antes da ação. Ao excluir um vendedor, o aviso apresenta as comissões e retiradas que também serão apagadas; uma comissão isolada não pode ser excluída se a carteira correspondente ficar negativa.
9. **Falha de armazenamento:** erro de `localStorage` informa o usuário sem afirmar que a alteração foi salva.

## 9. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Limpeza de dados do navegador | perda dos dados locais | aviso no README e exportação CSV disponível |
| Erro de digitação em valores | comissão incorreta | validação, prévia do cálculo e edição do registro |
| Exclusão acidental | perda de histórico ou saldo incorreto | confirmação com contagem de movimentações vinculadas e proteção contra carteira negativa na exclusão isolada de comissão |
| Dados sem vendedor por edição manual do armazenamento | histórico inconsistente | usar `sellerName` como fallback visual |

## 10. Critérios finais de aceite

- [ ] É possível cadastrar, editar e excluir vendedores sem comissões vinculadas.
- [ ] É possível registrar comissão percentual e fixa, e os cálculos batem.
- [ ] Dados persistem após recarregar a página.
- [ ] Filtros alteram a tabela, totais, gráfico e CSV de modo consistente.
- [ ] Edição e exclusão de comissão funcionam com confirmação para exclusão.
- [ ] A interface não possui overflow horizontal em desktop ou celular.
- [ ] O JavaScript passa em verificação de sintaxe e os cenários de teste automatizados passam.
