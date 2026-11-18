# Métricas de log do Billing

O Billing emite logs JSON estruturados com o campo `metric` para os sinais financeiros que viram alerta. O Datadog gera as métricas a partir desses logs (`datadog_logs_metric`, Terraform da E35); o Billing não usa APM nem biblioteca de métricas (D7.3).

## Formato

Cada sinal é uma linha de log cujo `message` é um JSON com `metric` e o contexto técnico. A serialização é única, em `src/shared/observability/metrica-log.ts` (`METRICA_LOG` e `serializarMetricaLog`). O `JsonLoggerService` envolve essa linha no log do processo, que traz `service`, `level`, `environment` e `version`.

```json
{
  "metric": "billing.pendencia_estorno_aberta",
  "ordemServicoId": "...",
  "rodada": 1,
  "correlationId": "...",
  "operacaoId": "...",
  "cobrancaId": "...",
  "motivo": "reparo_iniciado"
}
```

Campos de contexto: `ordemServicoId`, `rodada`, `correlationId`, `operacaoId`, `cobrancaId` e `motivo`. Só `undefined` é omitido do JSON; `null` sai como `null`. Nos dois sinais novos o `motivo` é um código fixo. Nunca entram dados pessoais, tokens nem valores financeiros: apenas esses campos são serializados.

Como o JSON chega dentro de `message`, o pipeline de logs do Datadog precisa de um _Grok parser_ com `%{data::json}` sobre o `message` para que `@metric` e os demais campos virem atributos pesquisáveis. Sem esse parser, a consulta e a `datadog_logs_metric` abaixo não encontram os eventos.

O `service` dos logs é `billing-api` (autodiscovery em `k8s/deployment.yaml`; o padrão do logger é o mesmo).

## Métricas

| `metric`                                    | Nível  | Significado                                                                                                                                                   | `motivo`                                                                                                    |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `billing.situacao_financeira_indeterminada` | `info` | A consulta da situação financeira de uma cobrança terminou sem resposta conclusiva do Mercado Pago e foi registrada em `PendenciaFinanceiraMonitoramento`.    | Vem da consulta (comportamento anterior) e pode ser texto livre do erro do gateway                                                                                   |
| `billing.operacao_financeira_indeterminada` | `warn` | Uma operação de cancelamento financeiro esgotou as tentativas com a mesma chave de idempotência e o resultado no Mercado Pago continua indeterminado (D3.15). | `tentativas_esgotadas`                                                                                      |
| `billing.pendencia_estorno_aberta`          | `warn` | Uma pendência manual de estorno foi criada e a cobrança passou a `PENDENCIA_MANUAL`.                                                                          | `reparo_iniciado` (cobrança paga com reparo já iniciado) ou `operacao_indeterminada` (tentativas esgotadas) |

## Consultas Datadog sugeridas

```text
service:billing-api @metric:billing.situacao_financeira_indeterminada
service:billing-api @metric:billing.operacao_financeira_indeterminada
service:billing-api @metric:billing.pendencia_estorno_aberta
```

Cada `datadog_logs_metric` pode usar essa consulta como filtro, com agregação `count` e, se útil, agrupamento por `@motivo`. Evite agrupar por `@ordemServicoId`, `@correlationId`, `@operacaoId` ou `@cobrancaId` na métrica, pois têm cardinalidade alta; use-os na busca de logs para investigar.

## Contagem e repetições

Cada log corresponde a um evento, mas a contagem é por emissão, não por entidade:

- `billing.pendencia_estorno_aberta`: emitido uma vez por pendência criada, depois do commit que cria a pendência. Se a conclusão da operação falhar, o reprocessamento encontra a cobrança em `PENDENCIA_MANUAL` e não emite de novo.
- `billing.operacao_financeira_indeterminada`: emitido uma vez quando a operação atinge o limite de tentativas. Se a abertura da pendência falhar (erro de banco), o próximo ciclo do job repete o sinal junto com uma nova tentativa registrada.
- Quando as tentativas se esgotam em cobrança paga, os dois sinais são emitidos (indeterminada, depois pendência aberta). Para alertar só "pendência aberta", use `billing.pendencia_estorno_aberta`; para a causa técnica, `billing.operacao_financeira_indeterminada`.
- `billing.situacao_financeira_indeterminada`: emitido a cada registro na tabela de monitoramento, depois do `INSERT`.

## Limitações conhecidas

- `billing.operacao_financeira_indeterminada` é emitido antes de `abrirPendencia`. O sinal pode existir sem a pendência correspondente, por exemplo quando a abertura falha.
- Defeitos registrados para antes da E36, ainda não corrigidos:
  - No caminho de estorno, a cobrança fica em `ESTORNO_EM_ANDAMENTO` depois de um estorno indeterminado. As tentativas não chegam ao limite e o sinal não é emitido por esse caminho até a correção pré-E36.
  - Ao esgotar as tentativas com cobrança não paga, `marcarPendenciaManual` lança erro depois do log. O sinal sai, mas a pendência não nasce e `billing.pendencia_estorno_aberta` não é emitido.
- O sinal `billing.operacao_financeira_indeterminada` é alcançável hoje no cancelamento de cobrança não paga com Mercado Pago indeterminado.
