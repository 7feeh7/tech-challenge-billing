# RELATORIO — E04 Prova técnica Mercado Pago (Orders API)

**Atualização da sessão:** 2026-11-15. Ambiente **teste**; webhook fora do escopo (E05).

## Resumo executivo

| Resultado | Qtd | Observação |
| --- | --- | --- |
| Comprovado em runtime | 0 | Execução bloqueada sem `prova-tecnica/.env` |
| Pendente de credencial + `yarn prova-tecnica` | 12 | Script `executar.ts` pronto |
| Hipótese (só documentação) | — | Marcados no script com `hipoteseDocumentacao` |

## Impedimento

`IMPEDIMENTO: credenciais de teste ausentes em prova-tecnica/.env — D3.1 — copiar .env.example preenchendo MP_ACCESS_TOKEN e MP_PAYER_EMAIL no repositório local — após configurar, rodar yarn prova-tecnica e repetir checkout APRO/FUND conforme README`

Nenhum token ou segredo foi versionado.

## Cenários previstos (D3.11)

| ID | Operação | Escopo spec | Estado nesta sessão |
| --- | --- | --- | --- |
| C01 | Criar order + `checkout_url` + `external_reference` | Comprovado | Pendente credencial |
| C02 | Mesma `X-Idempotency-Key` | Comprovado | Pendente credencial |
| C03 | GET order (status, referência) | Comprovado | Pendente credencial |
| C04 | Cancelar sem pagamento | Comprovado | Pendente credencial |
| C05 | `expiration_time` PT45S | Comprovado | Pendente credencial |
| C05b | Limites `expiration_time` (PT3M, PT5M, P1D) — D4.6 | Comprovado/limitado | Pendente credencial |
| C06 | Pagamento aprovado (APRO) | Comprovado | Pendente checkout + opc. `MP_ORDER_PAGA_ID` |
| C07 | Pagamento recusado (FUND) | Comprovado | Pendente checkout |
| C08 | Cancelar order paga | Comprovado (erro 4xx) | Depende C06 |
| C09 | Estorno total | Comprovado/limitado | Depende C06 |
| C10 | Estorno parcial | Comprovado/limitado | Depende segunda order paga |
| C11 | Timeout (`AbortSignal`) | Comprovado | Pendente credencial |

## Comportamentos esperados (documentação oficial — não comprovados em runtime)

Fonte: [Create order](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order), [Cancel](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-pro-orders/cancel-order/post), [Refunds](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/refunds-cancellations), [Test cards](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/integration-test/test-purchase-with-card).

- `POST /v1/orders` com `type: online`, `processing_mode: manual`, header `X-Idempotency-Key`.
- Cancelamento só para `created` / `action_required`.
- Estorno total: `POST /v1/orders/{id}/refund` sem corpo; parcial: `transactions[].amount`.
- Pagamento no Checkout Pro não é automatizável só por REST.

## Diferenças doc × projeto

- `billing.md` usa `expiration_time` derivado do prazo de pagamento (D4.6: **3 min** em demonstração). C05b valida aceitação de `PT3M`.
- Status exatos pós-pagamento (`processed` vs `paid`) — mapear na E17 após consultas reais.

## Impactos em decisões e contratos

| Decisão | Impacto |
| --- | --- |
| D3.15 | Script usa só `/v1/orders` (sem Preferências). |
| D3.10 | Cliente `fetch` + `AbortSignal.timeout` (C11). |
| D4.5 / D1.15 | C04/C08/C03 cobrem cancelamento e consulta; confirmação de pagamento por GET, não só webhook. |
| D4.6 | C05b exercita `PT3M`. |
| D1.20 | C09/C10 cobrem estorno total/parcial. |

## Limitações conhecidas (literatura MP)

- Conta de teste pode recusar estorno por saldo insuficiente.
- Checkout Pro exige interação no navegador para cartão.
- Webhook `orders_v2` — E05.

## Pendências para E05

- Validar webhook e HMAC `x-signature` em ambiente de teste.
- Política de reenvio e notificação de expiração.
- Fechar contratos financeiros `billing.*` com status HTTP/corpo reais desta prova (após execução).

## Como reproduzir (autor)

```bash
cp prova-tecnica/.env.example prova-tecnica/.env
# preencher MP_ACCESS_TOKEN e MP_PAYER_EMAIL (teste; não commitar)
yarn prova-tecnica
```

Este arquivo é **regenerado** por `executar.ts` após execução bem-sucedida; a seção acima registra o estado **antes** da primeira chamada à API.