# Galaxy Smart — Controle de Comissões

Painel interno da Galaxy Smart para controlar vendedores, registrar vendas e definir as comissões a pagar.

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

Um vendedor que já tenha comissões registradas não pode ser excluído. Isso evita que o histórico fique sem identificação.

## Como registrar e editar comissões

1. Cadastre pelo menos um vendedor.
2. Em **Registrar comissão**, escolha o vendedor, informe o valor da venda e selecione o tipo de comissão.
3. Para percentual, informe por exemplo `10` para 10%. Para valor fixo, informe por exemplo `150,00`.
4. Confira a prévia do valor calculado antes de salvar.

Produto/serviço e observação não são obrigatórios. A data começa preenchida com o dia atual, mas pode ser alterada.

No histórico, use **Editar comissão** para corrigir qualquer registro. A comissão calculada é salva no momento do lançamento; mudanças futuras não alteram vendas antigas.

## Carteiras e retiradas

Cada vendedor possui uma carteira própria. Toda comissão registrada entra como crédito nessa carteira; o **Saldo disponível** geral é a soma dos saldos de todos os vendedores.

Na seção **Carteiras dos vendedores**, selecione uma carteira para ver o saldo, o total de comissões, o total retirado e o histórico cronológico de créditos e débitos.

Em **Carteira e retirada**, escolha o vendedor, informe o valor, a data e uma observação opcional. O sistema bloqueia retiradas maiores que o saldo daquela carteira. Excluir uma retirada devolve automaticamente o valor ao vendedor.

Uma comissão que já tenha sido retirada não pode ser excluída nem reduzida a ponto de deixar a carteira negativa.

## Filtros, ordenação e exportação

- Filtre por vendedor e/ou por data inicial e final.
- Clique nos títulos de vendedor, valor de venda, comissão ou data para alterar a ordenação.
- Os cartões de resumo, o gráfico e a exportação consideram exatamente os filtros ativos.
- Clique em **Exportar CSV** para baixar os registros visíveis. O arquivo abre em Excel, LibreOffice Calc e outros programas de planilha.

## Onde os dados ficam

Os dados ficam somente no armazenamento local deste navegador e deste dispositivo. Eles continuam disponíveis após atualizar a página, mas não sincronizam com outro computador, outro celular ou outro navegador.

## Como fazer backup

Use **Exportar CSV** com os filtros desejados regularmente. Guarde o arquivo baixado em um local seguro. O CSV é a cópia de segurança desta versão, pois não há servidor ou nuvem.

## Como apagar todos os dados

A aplicação não oferece um botão de apagar tudo para evitar perda acidental. Para remover todos os dados deste navegador, abra as ferramentas de desenvolvedor do navegador, acesse o Console e execute:

```js
localStorage.removeItem('controle-comissoes.v1');
location.reload();
```

Essa ação é permanente nesta versão. Exporte um CSV antes de executar se quiser preservar o histórico.
