# Galaxy Smart — operações, auditoria e uso mobile

## Objetivo
Transformar o painel já publicado em uma operação diária completa: leitura financeira rápida, filtros coerentes, exportação segura, histórico verificável de pagamentos e anulações, e uso confortável no celular.

## Requisitos funcionais

1. **Resumo financeiro administrativo**
   - Exibir vendas registradas, comissões pendentes, comissões pagas, total de comissões e quantidade de registros no conjunto filtrado.
   - Exibir ranking de vendedores pelo total de comissão, preservando cálculos exatos em texto decimal.
   - Mostrar claramente quando o resumo representa filtros ativos e quando não há resultados.

2. **Filtros e exportação**
   - Manter filtros existentes de vendedor, período e situação para lista, métricas, ranking e CSV.
   - Manter comissões anuladas fora dos totais financeiros e de vendas usados para operação.
   - Exportar uma cópia administrativa em JSON com vendedores públicos, comissões e eventos financeiros; nunca incluir e-mail técnico, senha, token, identidade Auth ou segredo.

3. **Histórico financeiro**
   - Oferecer ao administrador uma aba de histórico para pagamentos e anulações.
   - O histórico deve usar os eventos já gravados em `commission_payment_events`, identificar a comissão, o vendedor e o responsável pelo evento, e respeitar os filtros de comissão aplicados.
   - O endpoint e a interface são exclusivos da administração.

4. **Experiência e acessibilidade**
   - Tela administrativa deve funcionar em 320px sem rolagem horizontal de tabela como único meio de uso: linhas de vendedores, ranking, comissões e histórico viram cartões legíveis no celular.
   - Todos os botões têm estados de carregamento/desabilitado e feedback em `aria-live`.
   - Falhas no carregamento inicial oferecem ação explícita para tentar novamente sem apagar filtros ou dados que já tenham sido mostrados.
   - Não reintroduzir e-mail no contrato ou na interface pública de vendedor; telefone permanece opcional.

5. **Confiabilidade**
   - Estabilizar o teste de inicialização de `server.js` para cargas concorrentes de CI, preservando a validação de que `/health` responde na porta configurada.
   - Nenhum novo acesso do browser ao Supabase, nenhuma alteração de RLS e nenhum uso de valores financeiros em ponto flutuante como fonte de verdade.

## Contratos propostos

### `GET /api/audit-events`
Autorização: administrador ativo.

Query opcional: `sellerId`, `startDate`, `endDate`, `paymentStatus`; iguais aos filtros de comissões. O resultado é:

```json
{
  "items": [
    {
      "id": "uuid",
      "eventType": "paid",
      "previousStatus": "pending",
      "newStatus": "paid",
      "occurredAt": "ISO-8601",
      "commissionId": "uuid",
      "sellerId": "uuid",
      "sellerName": "Nome público",
      "product": "Produto",
      "saleDate": "YYYY-MM-DD",
      "commissionValue": "12.34",
      "actorName": "Nome público"
    }
  ]
}
```

### `GET /api/admin/backup.json`
Autorização: administrador ativo. Retorna download JSON, `Cache-Control: no-store`, com:

```json
{
  "generatedAt": "ISO-8601",
  "sellers": [{"id":"uuid","name":"Nome","username":"usuario","phone":"","defaultCommissionRate":null,"active":true}],
  "commissions": ["contrato público de comissão existente"],
  "auditEvents": ["contrato de evento acima"]
}
```

## Limites de segurança

- Somente API Express/Vercel usa o cliente administrativo Supabase.
- Manter RLS deny-all e grants exclusivos de `service_role`.
- Dinheiro é serializado de inteiros em centavos para strings decimais; taxas ficam em pontos-base.
- Exclusões financeiras continuam sendo anulações; eventos e registros financeiros não são apagados.
- Nenhuma chave, senha, e-mail técnico, refresh token ou dado de Auth aparece em JSON, CSV, DOM, logs, testes ou documentação.

## Fora de escopo

- Alterar regras de cálculo de comissão, criar novos papéis, migrar dados legados, adicionar dependências de analytics ou modificar contas reais para teste.
