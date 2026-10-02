# Universe TI — Redesign executivo editorial

## Contexto

A Universe TI opera uma plataforma interna de gestão de comissões. A interface atual já está em produção e usa Vite com JavaScript e CSS puros. Este trabalho substitui sua camada de marca e apresentação sem alterar autenticação, APIs, permissões, cálculos, pagamentos, arquivamento ou auditoria.

A estimativa de colaboradores ainda não está definida; o design deve manter leitura confortável tanto para equipes pequenas quanto para uma tabela operacional maior.

## Objetivo

Criar uma experiência corporativa sóbria para a Universe TI: clara em segundos na home, rápida no login e precisa ao trabalhar com valores de comissão. A linguagem é de fintech executiva, sem parecer template de SaaS ou página genérica de IA.

## Marca

- Nome visível em toda a interface: **Universe TI**.
- Wordmark SVG sem ícone, slogan ou imagem rasterizada.
- “Universe” em branco suave e “TI” em roxo.
- O SVG deve conter o texto unido em um único sistema tipográfico; sem elementos separados por margem, padding ou espaço literal indevido.
- `alt` de cada ocorrência: `Universe TI`.

## Direção visual

### Paleta

| Papel | Código |
| --- | --- |
| Canvas | `#111017` |
| Canvas profundo | `#0D0C12` |
| Superfície | `#1A1722` |
| Superfície elevada | `#231E2E` |
| Texto | `#F8F7FC` |
| Texto secundário | `#B8B1C6` |
| Roxo primário | `#7C3AED` |
| Roxo claro | `#A78BFA` |
| Sucesso | `#4E9F79` |
| Pendência/erro | `#C96870` |

Roxo aparece somente em CTAs, navegação selecionada, foco, identidade e destaques financeiros importantes. Sucesso e erro permanecem discretos e legíveis.

### Tipografia e números

A fonte permanece a pilha sans-serif local do sistema, evitando carregamento remoto. Títulos usam peso alto e tracking negativo moderado. Valores financeiros, percentuais e dados de tabela usam `font-variant-numeric: tabular-nums` para alinhamento preciso.

### Interação e acessibilidade

- Estados de hover, foco e abertura usam transições de 200–300 ms com curva suave.
- Foco de teclado roxo, com contraste AA.
- Sem gradientes de texto, ícones grossos, brilho excessivo, blur sobre conteúdo rolável ou emojis decorativos.
- Espaços e separadores finos organizam a interface sem grade pesada.

## Superfícies

### Home pública

A rota raiz começa deslogada em uma home institucional, não diretamente no formulário:

1. Hero com o wordmark Universe TI, título “Comissões sob controle.”, explicação curta e CTA “Acessar plataforma”.
2. Três blocos de benefícios baseados em capacidades existentes: acompanhamento de comissões, pagamentos organizados e gestão de equipe.
3. Rodapé compacto com identidade Universe TI e contato de suporte configurável ou texto neutro, sem inventar canais.
4. O CTA abre a experiência de login sem expor qualquer dado administrativo.

A home é editorial e espaçada; não proclama métricas, integrações ou promessas sem evidência no produto.

### Login

O login preserva campos, acessibilidade e fluxo atuais. Reaproveita o contexto visual da home, com identidade na área de marca e formulário conciso na área de acesso. Em telas pequenas, é uma única coluna sem overflow horizontal.

### Painel administrativo e carteira do colaborador

- Cabeçalho com wordmark Universe TI pequeno, saída e contexto de sessão.
- Abas ativas, botões e foco com roxo reservado.
- Métricas priorizam o valor financeiro e rótulos silenciosos.
- Tabelas usam linhas finas, cabeçalho contido e números tabulares; mobile conserva os rótulos de cada célula.
- Gráfico mensal existente recebe contraste calmo e barras roxas, sem criar indicador de meta sem suporte de dados.
- Estados vazios, carregamento e feedbacks usam as estruturas existentes, apenas com acabamento coerente.

## Escopo

### Incluído

- Home pública funcional com caminho claro para login.
- Troca da marca de Galaxy Smart para Universe TI em assets, login, cabeçalhos, avisos e testes relevantes.
- Correção definitiva do espaçamento do wordmark.
- Redesign de login, painel de administrador, carteira do colaborador, tabela, formulário, filtros, gráfico, estados vazios e notificações existentes.
- Responsividade e contraste AA.

### Excluído

- Metas, ranking, perfil individual, detalhe de comissão ou notificações em tempo real novos: não há dados, API ou regras de negócio implementadas para esses recursos.
- Alterações de banco, endpoints, permissões, login, cálculos, pagamentos ou arquivamento.
- Bibliotecas, fontes, imagens, ícones ou serviços externos.

## Verificação

- Testes de login garantem que a home e o login não removem os campos e semântica atuais.
- Suíte completa, `npm run check`, `npm run build`, `git diff --check` e detector visual executados.
- Navegador verifica home/login em desktop e mobile: zero overflow, CTA funcional, marca legível e rotas sem 404.
- Produção verifica `/health`, asset SVG, home e login inválido (resposta de aplicação sem mutação).
