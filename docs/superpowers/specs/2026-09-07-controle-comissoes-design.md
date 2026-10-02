# Design técnico — Controle de Comissões

**Data:** 2026-09-07
**Status:** aguardando revisão do usuário

## Decisão de arquitetura

Será uma aplicação estática em três arquivos, sem framework, backend, rede ou etapa de compilação:

```text
controle-comissoes/
├── index.html
├── style.css
├── app.js
├── tests/
│   └── logic.test.js
├── docs/
│   ├── PRD.md
│   └── superpowers/specs/2026-09-07-controle-comissoes-design.md
└── README.md
```

A escolha reduz manutenção e permite abrir `index.html` diretamente. `app.js` será incluído como script clássico com `defer`, compatível com `file://`.

## Interface e componentes

A página terá uma barra de cabeçalho e quatro áreas:

1. **Resumo:** cartões com total no período filtrado, quantidade de registros e vendedores com comissão; gráfico de barras por vendedor.
2. **Comissão:** formulário principal com seletor de vendedor, produto, venda, modo de comissão (percentual/fixo), valor, data e observação. Uma prévia mostra o valor calculado.
3. **Histórico:** filtros combináveis, botão de exportação CSV, tabela ordenável e ações de editar/excluir.
4. **Vendedores:** formulário compacto de cadastro/edição e lista com contato e ações.

No celular, os blocos passam para uma coluna e a tabela fica dentro de um contêiner rolável apenas nela. Cada controle terá `<label>` associado; erros usarão uma região `aria-live`.

## Fluxo de dados

- `loadState()` lê e valida `controle-comissoes.v1`, retornando coleções vazias para primeiro uso ou armazenamento inválido.
- Ações de formulário alteram um objeto em memória e chamam `saveState()`; persistência bem-sucedida é seguida por `renderAll()`.
- `getFilteredCommissions()` centraliza vendedor, período e ordenação. Tabela, cartões, gráfico e CSV usam exatamente essa função para evitar divergência.
- Valores em BRL são convertidos por um normalizador que aceita `1.234,56`, `1234,56` e `1234.56`; apenas valores finitos maiores que zero são aceitos.
- A comissão calculada é persistida no registro; mudanças futuras no percentual não alteram vendas antigas.

## Regras explícitas

- Vendedor: nome obrigatório, contato opcional.
- Comissão: vendedor, valor de venda, tipo e valor de comissão obrigatórios; produto e observação opcionais.
- Percentual: valor da comissão = `saleValue * commissionInput / 100`.
- Fixo: valor da comissão = `commissionInput`.
- Valores devem ser maiores que zero; percentual pode ser maior que 100 quando o usuário realmente precisar disso.
- Data padrão é a data local do navegador em formato `YYYY-MM-DD`.
- Ao editar vendedor, o nome atualiza nas comissões relacionadas e preserva o histórico consistente.
- Vendedor com comissões vinculadas não pode ser excluído; o app explica o motivo.
- Excluir comissão usa confirmação e remove o registro imediatamente após a confirmação.
- Filtro sem resultado apresenta estado vazio, sem zerar os dados persistidos.

## Exportação e gráfico

- CSV é gerado no navegador com BOM UTF-8, separador `;` e campos escapados.
- O nome incluirá a data de exportação, por exemplo `comissoes-2026-09-07.csv`.
- O CSV contém somente os registros filtrados no momento, em sua ordenação atual.
- O gráfico será uma lista de barras CSS acessível, com texto alternativo do valor por vendedor. Não serão usadas bibliotecas externas.

## Estilo e compatibilidade

- CSS mobile-first, variáveis no `:root`, sistema de espaçamento 8/16/24/32/48px e foco visível.
- Tipografia nativa de sistema, para não depender de internet.
- Cores neutras de alto contraste, estados de erro/sucesso e preferência por movimento reduzido respeitada.
- Compatibilidade-alvo: navegadores modernos de desktop e celular com suporte a `localStorage` e `Intl.NumberFormat`.

## Estratégia de teste e verificação

1. Testes Node sem dependência para cálculo percentual/fixo, normalização, filtros, ordenação e serialização CSV.
2. `node --check app.js` para sintaxe.
3. Servidor local e verificação HTTP de `index.html`, `style.css` e `app.js`.
4. Navegador automatizado: validar cadastro, cálculo, persistência após recarga, filtros, edição, exclusão e exportação.
5. Medição de overflow horizontal em tamanho desktop e celular.

## Segurança e limitações conhecidas

Não há dados sensíveis, credenciais ou chamadas externas. Como os dados são locais ao navegador, não há sincronização entre dispositivos e apagar os dados do site pode removê-los. O README explicará a exportação frequente como cópia de segurança.
