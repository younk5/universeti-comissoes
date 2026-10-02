# Operação e recuperação

## Primeiro administrador

1. Confirme por sessão autorizada que o banco Supabase correto está vazio.
2. Na estação segura, defina `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e as quatro variáveis `BOOTSTRAP_ADMIN_*` apenas no processo local.
3. Execute `node --env-file=.env scripts/bootstrap-admin.js` uma única vez.
4. Confirme a criação sem registrar senha, token ou chave em tickets, logs ou chat.
5. Remova `BOOTSTRAP_ADMIN_PASSWORD` e qualquer arquivo temporário da estação.

O bootstrap falha se já houver administrador ou uma trava concorrente. Investigue pelo acesso administrativo autorizado; não repita comandos às cegas nem crie uma segunda identidade manualmente.

## Desativar e reativar vendedor

- Use a ação **Desativar** do painel administrativo. Ela mantém o perfil e histórico, avança a janela de sessão e bloqueia novo acesso.
- Para reativar, use a rota administrativa autorizada e exija novo login do vendedor. Uma sessão anterior não deve voltar a valer.
- Para redefinir acesso, solicite **Gerar senha temporária**. Anote a senha apresentada uma única vez e entregue-a por canal aprovado. Ela não deve ser registrada em observações, CSV, banco ou suporte.
- Não apague vendedores para resolver problemas operacionais; relações financeiras e auditoria devem permanecer preservadas.

## Exportação e teste de recuperação

1. Antes de operar valores reais, gere um export do PostgreSQL em armazenamento controlado pela organização, fora do Git, Vercel e diretório do projeto.
2. Proteja o arquivo com as regras de acesso e retenção aprovadas; trate-o como dado sensível.
3. Periodicamente, restaure o export em ambiente separado, sem conexão ao banco de produção.
4. Verifique contagens de perfis, comissões e eventos de pagamento, além de um fluxo de leitura de seller isolado.
5. Registre data, responsável, versão do export e resultado do teste sem anexar o dump ao repositório.

Reavalie o plano gratuito antes de exceder cotas, precisar de backup gerenciado, suporte ou alta disponibilidade.

## Rotação de chave de serviço

Se houver suspeita de exposição de `SUPABASE_SERVICE_ROLE_KEY`:

1. Interrompa o uso da chave suspeita e registre o incidente no canal interno aprovado.
2. Em sessão Supabase autorizada, gere e ative uma nova chave conforme o procedimento atual do provedor.
3. Atualize somente a variável Production correspondente na Vercel; não coloque a chave em arquivos, cliente ou comandos copiados para histórico.
4. Faça novo deploy, invalide a chave antiga e verifique `/health`, CSP same-origin e acesso anônimo negado.
5. Revise logs e acessos conforme a política da organização.

## Rollback de aplicação

A branch histórica baseada em Firebase é preservada apenas como referência de rollback da aplicação. Um rollback não deve importar, apagar ou reconfigurar dados Supabase, nem expor credenciais históricas.

1. Pare e avalie o incidente com o responsável autorizado.
2. Escolha uma revisão conhecida da aplicação e faça a reversão usando o fluxo de mudança aprovado.
3. Mantenha o banco Supabase intacto até existir um plano de dados explícito e revisado.
4. Depois da reversão, verifique saúde, cabeçalhos e negação de acesso anônimo antes de reabrir o serviço.
5. Registre impacto, versão restaurada e plano de correção sem registrar segredos.
