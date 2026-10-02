# Task 8 — UI, operações Supabase e limpeza de Firebase

## Entregue

- A UI administrativa anula somente comissões pendentes por `DELETE /api/commissions/:id` e usa a cópia “Anular comissão”.
- A seller view troca senha por `POST /api/auth/password`.
- Valores monetários, totais, prévias, filtro e série mensal permanecem strings decimais e são formatados sem conversão para ponto flutuante.
- A senha temporária administrativa é apresentada uma única vez e não é reenviada à API.
- Removidos script e comando de emulator; CSP não permite conexões externas Firebase ou Supabase pelo navegador.
- O scanner bloqueia identificadores Firebase em runtime/configuração e preserva somente documentação histórica permitida.
- `scripts/cloud-smoke.js` exige `ALLOW_CLOUD_SMOKE=1`, banco vazio, cria fixtures `qa-`, verifica isolamento/evento de pagamento e tenta limpeza no `finally`.
- README, guia de deploy e operações descrevem a hospedagem Vercel/Supabase, bootstrap, desativação, exportação/recuperação, rotação e rollback.

## Correção da revisão — rodada 1

- O scanner também bloqueia identificadores Firebase em `src/server/config.js`; o guard de variáveis legadas continua funcional sem conter esse identificador no artefato de runtime.
- A limpeza do cloud smoke considera `auth.users` removido somente com `data.user === null` sem erro ou erro explícito 404/not-found; usuários presentes e falhas de servidor/transporte são reportados como survivors.

## Correção da revisão — rodada 2

- A limpeza do cloud smoke confirma `auth.users` ausente somente por `status`, `statusCode` ou `code` numérico `404`, ou pelo código canônico exato `user_not_found`.
- Mensagens de erro não são usadas como prova de ausência; respostas `500` com “user not found”, códigos não canônicos, erros malformados e falhas de transporte reportam `não foi possível confirmar auth.users`.

## Verificado

### Correção da revisão — rodada 2

```text
node --test tests/unit/cloud-smoke.test.js
4 passed, 0 failed

npm run check
npm run check:secrets
git diff --check
exit 0
```

### Correção da revisão — rodada 1

```text
node --test tests/unit/assert-no-secrets.test.js tests/unit/cloud-smoke.test.js tests/unit/config.test.js
26 passed, 0 failed

npm run check
npm run check:secrets
git diff --check
exit 0
```

### Entrega original

```text
node --test tests/unit/admin-view.test.js tests/unit/seller-view.test.js tests/unit/format.test.js tests/unit/vercel-deployment.test.js tests/unit/assert-no-secrets.test.js tests/unit/cloud-smoke.test.js
58 passed, 0 failed

npm run check
npm run check:secrets
git diff --check
exit 0
```

O smoke remoto não foi executado: ele requer ambiente Supabase autorizado, configuração válida e banco vazio. Nenhuma conta, recurso cloud ou deploy foi criado por esta tarefa.
