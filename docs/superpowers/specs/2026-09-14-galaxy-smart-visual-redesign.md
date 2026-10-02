# Galaxy Smart — redesenho visual operacional

## Objetivo

Redesenhar a interface do Galaxy Smart como um painel operacional premium, preservando integralmente autenticação, dados, endpoints, permissões, fluxos de criação/edição/arquivamento e textos de negócio em pt-BR.

## Direção aprovada

- Tema escuro em grafite profundo, sem fundos pretos chapados.
- Azul-violeta controlado para foco, seleção e ações principais; vermelho reservado para ações destrutivas e estados de erro.
- Aparência compacta e profissional: densidade suficiente para uso diário, com espaçamento e hierarquia claros.
- Sem emojis decorativos, excesso de gradientes, blur em conteúdo rolável, ilustrações genéricas ou estética de “dashboard de IA”.
- Tipografia de interface com escala consistente, títulos firmes e metadados discretos.

## Escopo visual

### Estrutura global

- Criar uma superfície de aplicação com fundo em camadas sutis, cabeçalho de produto mais claro e largura máxima maior para telas de desktop.
- Transformar a navegação em abas em uma barra operacional coesa, com estado ativo evidente e navegação utilizável em tela pequena.
- Unificar painéis, formulários, tabelas, diálogos, feedbacks e botões em tokens de cor, raio, borda, sombra e espaçamento.

### Login e estados de sessão

- Converter login e avisos de sessão em cartões focados, com marca, explicação e formulário legível.
- Melhorar contraste, foco de teclado, estados de erro e a percepção de profundidade sem alterar campos ou credenciais.

### Painel administrativo

- Reforçar a hierarquia entre resumo, vendedores, comissões, histórico e administradores.
- Tornar tabelas mais fáceis de escanear com cabeçalhos, estados, valores financeiros e ações mais distintos.
- Dar tratamento visual consistente a formulários de vendedores, comissões e administradores, incluindo feedbacks, filtros e ações em lote.
- Melhorar responsividade: em telas estreitas, converter controles em blocos verticais, preservar rótulos de dados de tabela e evitar overflow horizontal.

### Painel do vendedor

- Aplicar os mesmos tokens e hierarquia para carteira, filtros, extratos e resumo, preservando o escopo de dados já imposto pela API.

## Regras de preservação

- Não alterar contratos da API, persistência, RLS, autenticação, papéis, regras financeiras ou histórico/auditoria.
- Não remover confirmações de senha que continuam exigidas por regras atuais.
- Não introduzir fontes remotas, dependências visuais ou bibliotecas de ícones.
- Manter acessibilidade: contraste, `focus-visible`, alvos de toque, rótulos e diálogos existentes.

## Implementação prevista

1. Consolidar tokens e regras globais no CSS existente.
2. Ajustar somente a marcação necessária nas views para suportar cabeçalhos, agrupamentos e estados visuais consistentes.
3. Preservar toda a lógica JavaScript; mudanças de view serão estruturais e cobertas por testes existentes ou novos testes de renderização.
4. Validar desktop e mobile, além de login e painéis autenticados simulados.

## Verificação

- Testes unitários e de API completos.
- Checagem de sintaxe, build e `git diff --check`.
- Auditoria visual desktop e mobile com captura de tela e verificação de overflow.
- Confirmação do deploy Vercel, health e rota de autenticação não mutável em produção.
