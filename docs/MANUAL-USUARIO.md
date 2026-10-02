# Manual do Usuário — Controle de Comissões

Este manual explica, passo a passo, como usar o sistema no dia a dia. Ele foi escrito para quem **não** entende de programação. Não é preciso instalar nada: tudo funciona pelo navegador (Chrome, Edge, Firefox ou Safari).

---

## 1. O que é este sistema

É a plataforma da Universe TI para controlar **vendedores**, **produtos/serviços** e **comissões**.

Com ela você consegue:

- Cadastrar vendedores e dar acesso a eles.
- Definir quanto cada produto/serviço paga de comissão.
- Registrar vendas e ver automaticamente o valor da comissão.
- Marcar comissões como pagas.
- Consultar o histórico financeiro e baixar uma planilha (CSV).

---

## 2. Como entrar

1. Abra o navegador e acesse: **https://universeti.vercel.app**
2. Preencha:
   - **Usuário**: seu nome de usuário (ex.: `UniverseTI`).
   - **Senha**: sua senha pessoal.
3. Clique em **Entrar**.

> Você também pode entrar digitando seu **e-mail** no lugar do usuário.

Se aparecer **“Usuário ou senha inválidos”**, confira se o teclado não está com o Caps Lock ligado e se digitou o usuário certo. Se continuar, peça a um administrador para redefinir sua senha.

Para sair, clique em **Sair** no canto superior direito.

---

## 3. Existem dois tipos de acesso

| Acesso | O que faz |
|---|---|
| **Administrador** | Cadastra vendedores e produtos, lança comissões, marca pagamentos e vê tudo. |
| **Vendedor** | Vê apenas a própria carteira: quanto tem a receber, quanto já recebeu e o extrato. |

O que você vê na tela depende do seu tipo de acesso. Se você é vendedor, verá a tela **Minha carteira** (seção 5). Se é administrador, verá a tela **Administração de comissões** (seção 4).

---

## 4. Guia do Administrador

Ao entrar, você vê o título **Administração de comissões** e, logo abaixo, seis abas:

**Resumo · Vendedores · Comissões · Produtos · Histórico · Administradores**

Clique no nome da aba para trocar de tela. Você começa sempre na aba **Resumo**.

### 4.1 Aba Resumo — visão geral do dinheiro

Mostra os números do período atual:

| Campo | Significado |
|---|---|
| **Vendas registradas** | Soma de todas as vendas lançadas. |
| **A pagar** | Total de comissões ainda pendentes (que você deve pagar). |
| **Pago** | Total de comissões já pagas. |
| **Total de comissões** | Soma de todas as comissões. |
| **Registros** | Quantidade de comissões lançadas. |

Abaixo há a lista **Totais por vendedor**, mostrando, para cada vendedor, quanto está **A pagar**, quanto já foi **Pago** e o **Total**.

Comissões **anuladas** ficam de fora desses totais.

No fim da página existe o botão **Baixar cópia administrativa**. Ele gera uma **planilha do Excel** (`.xlsx`) com quatro abas: **Resumo** (totais), **Vendedores**, **Comissões** e **Histórico**. Use com cuidado: o arquivo contém informações financeiras.

### 4.2 Aba Vendedores — cadastrar quem recebe comissão

**Para cadastrar um vendedor:**

1. Preencha **Nome**, **Usuário**, **Senha inicial** e, se quiser, **Telefone (opcional)**.
2. Clique em **Cadastrar vendedor**.
3. Anote a **senha inicial** e entregue ao vendedor. Ele poderá trocá-la depois.

O **Usuário** é o que a pessoa vai digitar para entrar. Use algo simples, sem espaços e sem acentos (ex.: `joao.silva`).

**Na lista de vendedores**, cada linha tem os botões:

| Botão | O que faz |
|---|---|
| **Editar** | Muda nome, usuário e telefone. |
| **Desativar** | Bloqueia o acesso, sem apagar nada. Pede sua senha. |
| **Excluir** | **Apaga para sempre** o vendedor, todas as comissões dele e o acesso. Pede sua senha. |

> Para quem foi desativado, aparece o botão **Ativar**, que devolve o acesso.

Sempre que alguém é desativado ou excluído, as sessões abertas dele são encerradas.

### 4.3 Aba Produtos — quanto cada item paga

Aqui você define as regras de comissão.

**Comissão padrão para itens sem regra individual**

É a regra usada quando você lança uma comissão escolhendo **“Lançamento manual ou legado”**.

1. Em **Modalidade da comissão**, escolha:
   - **Percentual**: um percentual sobre o valor da venda (ex.: 5 = 5%).
   - **Valor fixo**: um valor em reais por venda (ex.: 20,00).
2. Em **Valor da comissão**, digite o número.
3. Clique em **Salvar comissão padrão**.

**Cadastrar um produto ou serviço**

1. Em **Produto ou serviço**, digite o nome (ex.: `Plano anual`).
2. Em **Modalidade da regra**, escolha **Percentual** ou **Valor fixo**.
3. Em **Valor da regra**, digite o número.
4. Clique em **Cadastrar produto**.

**Na lista de produtos**, cada linha tem os botões:

| Botão | O que faz |
|---|---|
| **Editar** | Altera nome e regra. Ao mudar a regra, as comissões **pendentes** ligadas a esse produto são recalculadas automaticamente (pagas e anuladas não mudam). |
| **Desativar** | O produto deixa de aparecer para novos lançamentos. Não apaga nada. |
| **Reativar** | Volta a deixar o produto disponível. |
| **Excluir** | **Apaga o produto para sempre.** Pede sua senha. Só é permitido se **nenhuma** comissão estiver usando o produto. |

A coluna **Pendências afetadas** mostra quantas comissões pendentes foram recalculadas na última alteração de regra.

### 4.4 Aba Comissões — lançar e pagar

**Para registrar uma comissão:**

1. Em **Vendedor**, escolha quem fez a venda.
2. Em **Produto do catálogo**, escolha o produto (a regra de comissão já vem pronta), **ou** escolha **“Lançamento manual ou legado”** e preencha **Produto ou serviço (manual ou legado)**. Nesse caso vale a **comissão padrão**.
3. Preencha **Valor da venda** (ex.: `1200,00`) e **Data da venda**.
4. Se quiser, escreva uma **Observação**.
5. Confira a linha **Prévia da comissão** — ela mostra o valor que será pago antes de você salvar.
6. Clique em **Registrar comissão**.

**Na lista de comissões**, cada linha tem os botões:

| Botão | O que faz |
|---|---|
| **Editar** | Altera os dados da comissão (recalcula o valor conforme a regra). |
| **Anular comissão** | Marca a comissão como **anulada** (cancelada), preservando o registro para auditoria. Só aparece para comissões **pendentes**. Pede sua senha. |
| **Excluir** | **Apaga a comissão para sempre.** Pede sua senha. Funciona para comissões pendentes, pagas ou anuladas. |

**Marcar comissões como pagas:**

1. Marque a caixinha na primeira coluna das comissões **pendentes** que você pagou. (Só comissões pendentes podem ser selecionadas.)
2. Clique em **Marcar selecionadas como pagas**.

**Filtrar e exportar:**

- Use os campos **Vendedor**, **Data inicial**, **Data final** e **Situação** e clique em **Aplicar filtros**.
  - Situação: **Todas**, **Pendente**, **Pago** ou **Anulada**.
- Clique em **Baixar CSV** para baixar uma planilha com o que está filtrado. O arquivo abre no Excel, Google Planilhas e similares.

### 4.5 Aba Histórico — o que aconteceu

O **Histórico financeiro** lista os acontecimentos importantes, do mais recente para o mais antigo:

- **Pagamento**: quando uma comissão foi marcada como paga.
- **Anulação**: quando uma comissão foi cancelada.
- **Arquivamento de administrador**: quando um administrador foi arquivado.

Cada linha mostra vendedor, produto, valor, **Responsável** (quem fez a ação) e data/hora. Se houver novidades, aparece o botão **Atualizar histórico**.

### 4.6 Aba Administradores — outras pessoas que operam o sistema

1. Preencha **Nome**, **Usuário** e **Senha**.
2. Clique em **Cadastrar administrador**.

Na lista, o botão **Arquivar** remove o acesso dessa pessoa (pede sua senha). Não é possível arquivar a própria conta nem o último administrador ativo.

---

## 5. Guia do Vendedor

Ao entrar, o vendedor vê a tela **Minha carteira**, com:

- **A receber**: total de comissões ainda não pagas.
- **Já recebido**: total já pago.
- **Data inicial / Data final** + botão **Aplicar período**: filtra o extrato por datas.
- **Comissões pagas por mês**: gráfico de barras com o que foi pago em cada mês.
- **Extrato de comissões**: tabela com Produto, Venda, Comissão, Data e Status.
- **Alterar minha senha**: informe **Senha atual**, **Nova senha** e **Confirmar nova senha** e clique em **Alterar senha**. Depois disso você precisará entrar novamente.

O vendedor **não** vê dados de outros vendedores e **não** pode lançar, editar, pagar ou excluir comissões.

---

## 6. Ações que pedem a sua senha

Algumas ações são delicadas e por isso pedem que você digite **sua senha atual** antes de continuar:

- Desativar vendedor
- Excluir vendedor
- Anular comissão
- Excluir comissão
- Excluir produto
- Arquivar administrador

Aparece uma janela **“Confirmar ação sensível”**. Digite sua senha e clique no botão de confirmação. Se errar a senha, a ação não é feita.

> Aviso: **Excluir** apaga de verdade e não tem como desfazer. Se a intenção era apenas tirar de circulação, use **Desativar** (vendedor/produto) ou **Anular** (comissão).

---

## 7. Perguntas frequentes

**Esqueci minha senha. O que faço?**
Peça a um administrador para redefinir. Ele verá uma **senha temporária** na tela e você deve trocá-la depois em **Alterar minha senha**.

**Desativei um vendedor por engano. Dá para voltar?**
Sim. Na lista de vendedores, clique em **Ativar**.

**Excluí algo por engano. Dá para recuperar?**
Não. A exclusão é definitiva. Em compensação, o administrador pode baixar uma **cópia administrativa** (aba Resumo) para ter um backup dos dados.

**Não consigo excluir um produto.**
Provavelmente ele está sendo usado por alguma comissão. O sistema avisa: *“Este produto está em uso por comissões e não pode ser excluído.”* Exclua antes as comissões desse produto (ou apenas **Desative** o produto).

**Por que uma comissão antiga mudou de valor?**
Quando a regra de um produto muda, as comissões **pendentes** daquele produto são recalculadas. Comissões já **pagas** ou **anuladas** nunca mudam.

**O que é “Lançamento manual ou legado”?**
É uma comissão que não usa a regra de um produto específico. Nesse caso vale a **comissão padrão** definida na aba Produtos.

**Onde vejo quem recebeu o quê?**
Na aba **Histórico** (ações) e na aba **Resumo** em **Totais por vendedor**.

**Posso usar no celular?**
Sim. O sistema se adapta a telas pequenas, mas as tabelas ficam mais confortáveis no computador.

---

## 8. Glossário simples

| Termo | Significado |
|---|---|
| **Comissão** | O valor que o vendedor recebe por uma venda. |
| **Pendente** | Comissão ainda não paga. |
| **Pago** | Comissão já paga ao vendedor. |
| **Anulada** | Comissão cancelada (fica registrada, mas não conta nos totais). |
| **Percentual** | Regra em que a comissão é uma porcentagem do valor da venda. |
| **Valor fixo** | Regra em que a comissão é um valor em reais, igual para toda venda. |
| **Comissão padrão** | Regra usada quando o lançamento não usa um produto do catálogo. |
| **Catálogo** | Lista de produtos/serviços com suas regras. |
| **CSV** | Arquivo de planilha que abre no Excel/Google Planilhas. |
| **Administrador** | Pessoa com acesso total. |
| **Vendedor** | Pessoa que vê apenas a própria carteira. |

---

## 9. Cuidados e segurança

- **Nunca** compartilhe sua senha. Cada pessoa deve ter o próprio acesso.
- Use o botão **Sair** ao terminar, principalmente em computadores compartilhados.
- Confira sempre o valor na **Prévia da comissão** antes de registrar.
- Antes de **Excluir**, pergunte-se se **Desativar** ou **Anular** não resolve.
- O arquivo da **cópia administrativa** e o **CSV** contêm dados financeiros: guarde com cuidado.

---

## 10. Ajuda dentro do sistema

O sistema tem três ajudas, e todas ficam disponíveis na própria tela:

**Tutorial passo a passo (botão "Ajuda")**
Na primeira vez que você entra, um tutorial abre sozinho. Ele escurece a tela, ilumina o item da vez com um holofote e uma seta, e mostra uma miniatura da tela, o ícone e a explicação. Você avança **clicando no item destacado** ou no botão **Próximo**, e pode voltar com **Anterior**. No fim há uma pergunta rápida de revisão. Para rever quando quiser, clique em **Ajuda** no topo da tela.

**Modo Dicas (botão "Dicas")**
Clique em **Dicas** para ligar. Com ele ligado, passar o mouse (ou chegar com o teclado) em um botão ou campo mostra uma explicação do que ele faz. Clique de novo para desligar. O sistema lembra a sua escolha.

**Primeiros passos (lista de tarefas)**
Na aba **Resumo** existe uma lista com três tarefas iniciais: cadastrar um vendedor, definir um produto e a comissão padrão, e registrar uma comissão. Cada tarefa é marcada automaticamente quando você a conclui, e a lista avisa quando tudo estiver pronto.

## 11. Suporte

Em caso de dúvida, erro ou acesso bloqueado, procure o responsável pela administração da plataforma na sua empresa.