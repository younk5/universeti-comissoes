# Guia de implantação autorizada — Supabase + Vercel

Este guia prepara uma implantação; ele não cria contas, projetos, credenciais, variáveis nem publicação automaticamente. Acesso a Supabase ou Vercel exige sessão autorizada do titular. Valores reais ficam fora do Git e nunca são copiados para chat, logs ou artefatos de build.

`[REDACTED]` é somente marcador documental, nunca um valor utilizável.

## Pré-requisitos

- Node.js 22 ou superior e `npm install` concluído.
- Projeto Supabase vazio na região aprovada, com Auth por senha configurado e as migrations de `supabase/migrations/` aplicadas por sessão autorizada.
- Cadastro público no Auth desativado; contas são criadas apenas pelo bootstrap inicial ou pelo administrador autenticado.
- Banco, usuários, chaves, connection strings, dumps e logs permanecem fora do repositório.

## Variáveis de Production na Vercel

Cadastre somente estes nomes no ambiente **Production** do projeto, usando sessão Vercel autorizada:

| Variável | Tipo | Uso |
|---|---|---|
| `SUPABASE_URL` | Config | URL HTTPS do projeto Supabase autorizado. |
| `SUPABASE_PUBLISHABLE_KEY` | Secret | Usada somente pela API para login e renovação de sessão. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Acesso administrativo exclusivo do servidor. |

Não cadastre `BOOTSTRAP_ADMIN_*` de forma permanente. Use-as somente no computador seguro que executará o primeiro bootstrap e remova-as logo depois. Não use `VITE_` para nenhuma variável Supabase; o bundle Vite não recebe configuração ou conexão Supabase.

Preview e Development não reutilizam Production. Sem um ambiente Supabase isolado e autorizado, não configure variáveis de Production nesses escopos.

## Contrato de hospedagem

1. `npm run build` gera `dist`, que a Vercel entrega como arquivos estáticos.
2. `api/[...path].js` é a Function catch-all para `/api/*`, sem `listen()` e sem host estático Express.
3. `api/health.js` responde o health check; o único rewrite é `/health → /api/health`.
4. Não existe fallback SPA amplo: `/api/*`, `/assets/*` e demais arquivos de `dist` continuam sob resolução de sistema de arquivos/CDN.
5. `server.js` é somente local. Ele não é Function de produção.
6. A CSP mantém `connect-src 'self'` e `img-src 'self'`; o navegador não abre conexão externa para Supabase.

## Sequência autorizada de implantação

1. Valide localmente:

   ```bash
   npm test
   npm run build
   npm run check
   npm run check:secrets
   git diff --check
   ```

2. Em sessão Supabase autorizada, confirme que o projeto correto está vazio, aplique migrations e verifique RLS, grants e funções. Não prossiga se houver perfis ou comissões existentes.
3. Em sessão Vercel autorizada, adicione as três variáveis de Production acima sem revelar seus valores.
4. Execute o smoke remoto somente com configuração local temporária válida e banco confirmado vazio:

   ```bash
   ALLOW_CLOUD_SMOKE=1 node scripts/cloud-smoke.js
   ```

   O script cria apenas fixtures `qa-`, valida isolamento e evento de pagamento, e tenta removê-las no `finally`. Ele falha se qualquer fixture sobreviver.
5. Execute o bootstrap uma única vez na estação segura e remova as credenciais temporárias do ambiente.
6. Faça deploy somente após aprovação explícita para usar a sessão Vercel.
7. Depois do deploy, confirme `/health` com `200 {"status":"ok"}`, CSP same-origin e `GET /api/me` anônimo com `401`. Registre resultados sem incluir segredos.

Nenhuma implantação Vercel é executada por este repositório.