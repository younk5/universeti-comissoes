# Galaxy Smart — Redesign executivo roxo

## Objetivo

Substituir a camada visual atual por uma experiência corporativa premium para gestão interna de comissões. O resultado deve ser sóbrio, claro e confiável, com hierarquia forte para dados financeiros e uso diário em desktop e mobile.

## Escopo confirmado

O redesenho preserva exclusivamente as funcionalidades existentes:

- Login e recuperação de sessão.
- Painel administrativo com resumo, vendedores, comissões, histórico e administradores.
- Carteira do vendedor, extrato, filtro por período e alteração de senha.
- Formulários, filtros, pagamentos, anulações, arquivamentos e auditoria já existentes.

Não serão criados recursos de metas, ranking, perfil individual ou detalhe de comissão, pois a base atual não possui dados nem contratos para eles.

## Identidade visual

### Paleta

| Papel | Valor |
| --- | --- |
| Canvas grafite | `#111017` |
| Superfície | `#191723` |
| Superfície elevada | `#211E2C` |
| Texto principal | `#F8F7FC` |
| Texto secundário | `#BBB5CA` |
| Roxo de destaque | `#8B5CF6` |
| Roxo claro | `#A78BFA` |
| Positivo | `#4E9F79` |
| Pendência/erro | `#C96870` |

### Marca

A marca será um wordmark SVG sem ícone. “Galaxy” aparece em branco suave e “Smart” em roxo. Não haverá slogan, órbitas, blocos ou imagem rasterizada.

### Tipografia e números

A interface mantém uma família sans-serif de sistema para confiabilidade e desempenho. Títulos usam peso alto e tracking negativo controlado; textos operacionais usam escala compacta; valores financeiros usam `font-variant-numeric: tabular-nums`.

## Direção de interface

### Login

A página deve ter uma composição editorial em desktop: área de identidade contida, palavra de marca e mensagem curta em uma metade; formulário sem distrações na outra. Em mobile, as áreas empilham e o contexto de marca fica conciso.

### Superfícies autenticadas

- Cabeçalho com wordmark discreto, contexto da página e saída.
- Navegação por abas com seleção roxa controlada, não azul intensa.
- Métricas com valores dominantes, rótulos silenciosos e separadores finos.
- Formulários com agrupamento claro, inputs escuros, foco roxo e ações principais identificáveis.
- Tabelas com cabeçalhos de baixo contraste, linhas finas e números alinhados; no mobile permanecem cartões com rótulos de dados.
- Estados de sucesso, erro, vazio e carregamento usam a semântica existente, com cores discretas e leitura acessível.

## Restrições

- Não modificar API, banco, autenticação, regras financeiras, permissões, auditoria ou textos de negócio.
- Não adicionar bibliotecas, dependências, fontes remotas ou ícones externos.
- Manter contraste WCAG AA, foco de teclado, rótulos e diálogos acessíveis.
- Não usar emojis decorativos, gradientes em texto, glow excessivo, blur em conteúdo rolável ou aparência genérica de IA.

## Verificação

- Testes de renderização preservam campos, semântica e fluxos de login.
- Suíte completa, check, build e detector visual são executados.
- Produção é validada por health, rota de login inválido e asset de marca.
- Revisão visual é feita somente fora de abas pessoais do usuário.
