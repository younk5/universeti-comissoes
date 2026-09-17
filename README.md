# Universe TI — Controle de Comissões

Painel interno da Universe TI para controlar vendedores, registrar vendas e definir as comissões a pagar.

## Como abrir

1. Abra a pasta do projeto.
2. Dê duplo clique em `index.html`.
3. O navegador abrirá a aplicação. Não é necessário instalar nada nem criar conta.

Para desenvolvimento, também é possível abrir um servidor local na pasta do projeto:

```bash
python -m http.server 4173 --bind 127.0.0.1
```

Depois, acesse `http://127.0.0.1:4173/`.

## Como cadastrar vendedores

Na seção **Vendedores**, informe somente o nome. Use **Editar vendedor** para atualizar o cadastro.

Ao excluir um vendedor que já tenha comissões ou retiradas, o app avisa quantos registros serão apagados junto e só remove tudo depois da confirmação. Assim, excluir um vendedor limpa a carteira dele por completo — exporte o CSV antes se quiser guardar o histórico.

## Como registrar e editar comissões

1. Cadastre pelo menos um vendedor.
2. Em **Registrar comissão**, escolha o vendedor, informe o valor da venda e selecione o tipo de comissão.
3. Para percentual, informe por exemplo `10` para 10%. Para valor fixo, informe por exemplo `150,00`.
4. Confira a prévia do valor calculado antes de salvar.

Valores aceitam o formato brasileiro: `1.500`, `1.500,00`, `1234,56` e também `1234.56`.

Produto/serviço e observação não são obrigatórios. A data começa preenchida com o dia atual, mas pode ser alterada.

No histórico, use **Editar comissão** para corrigir qualquer registro. A comissão calculada é salva no momento do lançamento; mudanças futuras não alteram vendas antigas.

## Carteiras e retiradas

Cada vendedor possui uma carteira própria. Toda comissão registrada entra como crédito nessa carteira; o **Saldo disponível** geral é a soma dos saldos de todos os vendedores.

Na seção **Carteiras dos vendedores**, selecione uma carteira para ver o saldo, o total de comissões, o total retirado e o histórico cronológico de créditos e débitos.

Em **Carteira e retirada**, escolha o vendedor, informe o valor, a data e uma observação opcional. O sistema bloqueia retiradas maiores que o saldo daquela carteira. Excluir uma retirada devolve automaticamente o valor ao vendedor.

Uma comissão que já tenha sido retirada não pode ser excluída nem reduzida a ponto de deixar a carteira negativa.

Ao excluir um vendedor, o app informa quantas comissões e retiradas serão removidas junto. Confirme somente quando quiser apagar toda a carteira daquele vendedor.

## Filtros, ordenação e exportação

- Filtre por vendedor e/ou por data inicial e final.
- Clique nos títulos de vendedor, valor de venda, comissão ou data para alterar a ordenação.
- Os cartões de totais, o gráfico e a exportação consideram exatamente os filtros ativos. O cartão **Saldo disponível** mostra o saldo acumulado da carteira e acompanha apenas o vendedor selecionado (não o período).
- Clique em **Exportar CSV** para baixar os registros visíveis. O arquivo abre em Excel, LibreOffice Calc e outros programas de planilha.

## Fechamento do período

Na seção **Fechamento do período**, escolha a data inicial e a final para ver, por vendedor:
quanto de comissão entrou, quanto foi retirado e o saldo do período. Use **Exportar fechamento
(CSV)** para baixar essa visão — é o relatório pronto para conferência e pagamento.

## Backup e restauração (JSON)

Na seção **Backup dos dados**:

- **Exportar backup (.json)** baixa um arquivo com todos os vendedores, comissões e retiradas.
  Diferente do CSV, esse arquivo pode ser lido de volta pelo próprio painel.
- **Importar backup** restaura um arquivo exportado. A importação **substitui** os dados atuais,
  então o app pede confirmação antes.

Use o backup em JSON para trocar de aparelho ou navegador sem perder o histórico.

## Onde os dados ficam

Os dados ficam somente no armazenamento local deste navegador e deste dispositivo. Eles continuam disponíveis após atualizar a página, mas não sincronizam com outro computador, outro celular ou outro navegador.

## Como fazer backup

Exporte o **backup em JSON** (recomendado, permite restaurar) e, se quiser, o **CSV** com os filtros
desejados. Guarde os arquivos em um local seguro.

## Como apagar todos os dados

A aplicação não oferece um botão de apagar tudo para evitar perda acidental. Para remover todos os dados deste navegador, abra as ferramentas de desenvolvedor do navegador, acesse o Console e execute:

```js
localStorage.removeItem('controle-comissoes.v1');
location.reload();
```

Essa ação é permanente nesta versão. Exporte um CSV antes de executar se quiser preservar o histórico.

## Testes

As funções de cálculo, validação e formatação são testadas com o test runner do Node:

```bash
node --test tests/app.test.js
```
