# Design — Central de segurança dos dados

**Data:** 07/09/2026  
**Status:** aprovado em conversa; aguardando revisão deste documento antes do plano de implementação

## Objetivo

Proteger o histórico local da Galaxy Smart contra limpeza acidental do navegador, importação incorreta e corrupção pontual do armazenamento. O aplicativo continua estático, sem conta, servidor ou nuvem.

## Decisão

Será criada uma central de segurança com três camadas:

1. **Backup externo manual:** download de um arquivo JSON versionado, que sobrevive fora do navegador.
2. **Restauração validada:** o usuário escolhe um arquivo, vê uma prévia e confirma a substituição total da base local.
3. **Recuperação interna:** uma cópia local válida é mantida separadamente do estado principal; antes de uma restauração, o estado atual é salvo nela para permitir voltar atrás.

A opção recomendada é backup JSON manual porque é a única forma confiável de manter os dados após limpar o navegador sem introduzir backend, login ou custo de nuvem.

## Experiência na interface

Uma seção **Segurança dos dados** ficará após o resumo financeiro e antes dos formulários operacionais.

Ela conterá:

- status do último backup baixado e da última cópia interna;
- botão **Baixar backup agora**;
- botão **Restaurar backup** que abre o seletor de arquivo `.json`;
- prévia após selecionar um arquivo: data do backup, vendedores, comissões e retiradas encontradas;
- botão de confirmação explícita para substituir os dados locais;
- botão **Restaurar cópia interna** quando houver uma cópia válida.

A cópia interna é uma proteção complementar. A interface deixará claro que ela não substitui o arquivo baixado, pois ambos somem se os dados do navegador forem limpos.

## Modelo de dados

O estado operacional existente continua em `controle-comissoes.v1`:

```text
{
  sellers: [...],
  commissions: [...],
  withdrawals: [...]
}
```

Novas chaves independentes no `localStorage`:

```text
controle-comissoes.backup-meta.v1
{
  lastExportedAt: ISO-8601 | null
}

controle-comissoes.recovery.v1
{
  schemaVersion: 1,
  savedAt: ISO-8601,
  reason: "automatic" | "pre-restore",
  state: { sellers, commissions, withdrawals }
}
```

O arquivo exportado usa um envelope, para não aceitar JSON arbitrário como backup:

```text
{
  app: "Galaxy Smart Controle de Comissões",
  schemaVersion: 1,
  exportedAt: ISO-8601,
  state: { sellers, commissions, withdrawals }
}
```

O nome do arquivo seguirá `galaxy-smart-backup-AAAA-MM-DD-HHMM.json`.

## Fluxos

### Baixar backup

1. O app cria o envelope com o estado atual e data de exportação.
2. O navegador baixa o arquivo JSON.
3. O status informa a data e hora do último backup baixado.

### Importar e restaurar backup

1. O usuário seleciona um arquivo `.json`.
2. O app lê somente o conteúdo selecionado no navegador.
3. O arquivo precisa conter identificador da aplicação, versão suportada e coleções válidas.
4. A prévia mostra a data de exportação e as quantidades de itens.
5. Após confirmação explícita, o estado atual é salvo na cópia interna com motivo `pre-restore`.
6. O estado importado substitui integralmente vendedores, comissões e retiradas.
7. A interface é renderizada novamente e informa o resultado.

### Restaurar cópia interna

1. O botão fica disponível apenas quando a cópia interna é válida.
2. O app mostra data, motivo e contagens da cópia.
3. Após confirmação, substitui a base principal pela cópia interna.
4. Antes da troca, preserva o estado atual como nova cópia de recuperação.

### Salvamentos normais

Depois de um salvamento bem-sucedido, o estado válido também é gravado na cópia interna com motivo `automatic`. A cópia fica em uma chave separada para ser útil se a chave principal for alterada ou corrompida posteriormente.

## Validação e erros

- Arquivo não-JSON: rejeitado com mensagem clara.
- JSON sem o envelope Galaxy Smart, sem versão suportada ou com estrutura inválida: rejeitado sem alterar dados locais.
- Coleções inválidas ou itens sem campos essenciais: rejeitados; o app não tenta adivinhar ou corrigir um backup externo.
- Leitura de arquivo interrompida: aviso sem alteração de dados.
- Falha de `localStorage`: aviso de que a restauração não foi confirmada.
- Substituição total: sempre requer confirmação nativa com as quantidades que serão substituídas.

## Limites de escopo

- Sem envio automático a e-mail, Google Drive, Dropbox ou qualquer nuvem.
- Sem múltiplas versões navegáveis de backup interno nesta etapa.
- Sem mesclagem parcial de arquivo importado com os dados atuais, para impedir duplicidade financeira.
- CSV continua sendo relatório; não será aceito como arquivo de restauração.

## Arquivos a alterar

- `index.html` — seção e controles da Central de segurança.
- `style.css` — layout e estados visuais da central.
- `app.js` — serialização, validação, importação, recuperação e eventos da interface.
- `tests/app.test.js` — testes de envelope, validação, prévia, restauração e cópia interna.
- `README.md` — instruções de backup e recuperação para o proprietário.
- `docs/PRD.md` — requisito funcional e critérios de aceite atualizados.

## Testes e critérios de aceite

- Exportação produz envelope versionado contendo os três conjuntos de dados.
- Arquivo válido exibe a prévia correta sem alterar o estado até a confirmação.
- Arquivo inválido é bloqueado sem perda de dados.
- Restauração substitui a base inteira e atualiza carteira, resumo e histórico.
- Estado pré-restauração pode ser recuperado pela cópia interna.
- Última exportação e cópia interna ficam legíveis na interface.
- Testes Node, verificação de sintaxe e validação real em navegador desktop e celular passam.
