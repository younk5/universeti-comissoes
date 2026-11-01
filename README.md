# Galaxy Smart — Controle de Comissões

Plataforma web para uma rede de lojas administrar vendedores e comissões:
cadastro de vendedores, lançamento de vendas, cálculo de comissão, solicitações
de saque e relatórios — com login e permissões por perfil.

A decisão de arquitetura central: **o navegador nunca recebe credencial de banco**.
O cliente fala apenas com a API Node.js na mesma origem, e só a API acessa o
PostgreSQL via Supabase. Nenhuma URL, chave ou SDK de banco chega ao front-end.

**[▶ Abrir o sistema](https://universeti.vercel.app)**

![Painel do sistema](docs/print-painel.png)

`Node.js` · `PostgreSQL` · `Supabase Auth` · `Vercel` · `Vite`

📘 Manual do usuário em linguagem simples: [`docs/MANUAL-USUARIO.md`](docs/MANUAL-USUARIO.md)

---

Plataforma hospedada para administrar vendedores e comissões. O navegador fala apenas com a API Node.js na mesma origem; a API usa Supabase Auth e PostgreSQL no servidor. O cliente não recebe URL, chave, SDK ou acesso direto ao banco.

A base começa vazia. Dados de versões locais, `localStorage`, retiradas e backups legados não são importados.

## Manual do usuário

Para quem vai usar a plataforma no dia a dia (administradores e vendedores), o passo a passo em linguagem simples está em [docs/MANUAL-USUARIO.md](docs/MANUAL-USUARIO.md). As versões diagramadas, prontas para imprimir, importar no Google Docs ou abrir no Word, estão em [docs/MANUAL-USUARIO.docx](docs/MANUAL-USUARIO.docx) e [docs/MANUAL-USUARIO.html](docs/MANUAL-USUARIO.html).

## Requisitos

- Node.js 22 ou superior
- `npm`
- Projeto Supabase autorizado, vazio e com as migrations versionadas aplicadas

## Configuração local

1. Instale dependências:

   ```bash
   npm install
   ```

2. Copie o modelo sem versionar o resultado:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Preencha somente no ambiente local seguro:

   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

   A chave de serviço é exclusiva do servidor: não use prefixo `VITE_`, não a exponha ao navegador e não envie `.env`, senhas, tokens, dumps ou logs ao Git.

4. Inicie o desenvolvimento:

   ```powershell
   $env:NODE_OPTIONS = '--env-file=.env'
   npm run dev
   ```

   A API escuta em `http://127.0.0.1:3000`; o Vite entrega a interface e encaminha `/api`. `server.js` é somente a entrada local: `npm start` também serve o `dist` já construído para verificação local.

## Primeiro administrador

Com o banco Supabase vazio e autorizado, defina localmente `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME` e `BOOTSTRAP_ADMIN_PASSWORD`. O piso efetivo de senha é 6 caracteres, imposto pelo Supabase GoTrue hospedado.

```bash
node --env-file=.env scripts/bootstrap-admin.js
```

Execute esse bootstrap uma única vez, de uma estação segura. O script interrompe se já existir administrador ou se a criação concorrente estiver em andamento. Não use as variáveis `BOOTSTRAP_ADMIN_*` no build ou no deploy; remova a senha do ambiente após a criação.

## Verificações locais

```bash
npm test
npm run build
npm run check
npm run check:secrets
git diff --check
```

Para validar a aplicação empacotada, construa e rode a API localmente com ambiente de teste; então consulte `/health` e `/`.

## Produção

Na Vercel, `npm run build` produz `dist`, entregue estaticamente pela CDN. A função `api/[...path].js` atende `/api/*`; `api/health.js` atende o rewrite exato `/health → /api/health`. A interface permanece sem fallback SPA amplo: a interface não possui rotas profundas no cliente.

O procedimento autorizado, variáveis de Production e recuperação estão em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) e [docs/OPERATIONS.md](docs/OPERATIONS.md). Este repositório não cria contas, recursos externos ou deploys.