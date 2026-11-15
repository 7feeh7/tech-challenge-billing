# RELATORIO — E04 Prova técnica Mercado Pago (Orders API)

Ambiente **teste**; sem webhook (escopo E05).

## Resumo

| Resultado | Qtd |
| --- | --- |
| Comprovado | 12 |
| Limitado | 0 |
| Pendente | 0 |
| Indisponível | 0 |

**Webhook D3.11:** fora desta etapa (E05).

## Resultado final — 12 cenários (D3.11, sem webhook)

| ID | Operação | Resultado |
| --- | --- | --- |
| C01 | Criar order | comprovado |
| C02 | Idempotência `X-Idempotency-Key` | comprovado |
| C03 | Consulta GET order | comprovado |
| C04 | Cancelar sem pagamento | comprovado |
| C05 | Expiração `expiration_time` | comprovado (assíncrono ~4 min) |
| C05b | Limites expiration / D4.6 PT3M | comprovado |
| C06 | Pagamento aprovado APRO | comprovado |
| C07 | Pagamento recusado FUND | comprovado |
| C08 | Cancelar order paga | comprovado (409) |
| C09 | Estorno total | comprovado (ver § C09) |
| C10 | Estorno parcial | comprovado |
| C11 | Timeout `fetch` | comprovado |

## Incidência checkout — e-mail do pagador

| Item | Detalhe |
| --- | --- |
| Erro no checkout | *"Uma das partes com as quais você está tentando efetuar o pagamento é de teste"* |
| Causa provável | `payer.email` com usuário `@testuser.com` do painel, em sessão de navegador logada em conta não-teste |
| Solução comprovada | `MP_PAYER_EMAIL=comprador@example.com` ([doc BR](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/integration-test/test-purchase-with-card): comprador de teste dedicado **não** obrigatório) + checkout em janela anônima sem login |
| Order de evidência APRO | `ORDTST01M7GH2KEG5AH9PXBNF8S3AQ8A` — `processed` / `accredited` |

## 2ª passada — C06 a C10 (order paga + API)

| ID | Resultado | Evidência (sanitizada) |
| --- | --- | --- |
| C06 | comprovado | GET order `processed`, payment `PAY01M7GH58NFY2C2VE9B9J6M72NM` |
| C08 | comprovado | POST cancel → HTTP **409** `cannot_cancel_order` em `processed` |
| C10 | comprovado | POST refund parcial R$ 50 → **201** `partially_refunded` |
| C09 | comprovado | POST refund corpo vazio → **201** `refunded` (após parcial) |
| C07 | comprovado | Order `ORDTST01M7GH6V2XSBWK20R200BZBDXZ` — ver § C07 |

## C07 — Recusa FUND (confirmado via GET)

| Campo | Valor observado |
| --- | --- |
| Order id | `ORDTST01M7GH6V2XSBWK20R200BZBDXZ` |
| Status da order | `action_required` |
| Status detail da order | `waiting_retry` |
| Payment id | `PAY01M7GHG1DPM4Q80HQ7ZJRSKR1F` |
| Status do pagamento | `failed` |
| Motivo da recusa | `insufficient_amount` (cartão teste titular **FUND**) |

**Diferença doc × runtime:** `billing.md` cita order `failed`; na API teste a order ficou `action_required`/`waiting_retry` com pagamento `failed` — alinhado à doc MP de retentativas Checkout (`config.online.retries`). **E17:** tratar recusa pelo status do **pagamento** e/ou order, não só `failed` na order.

## C09 — Estorno total após parcial (detalhamento)

**Sequência na order `ORDTST01M7GH2KEG5AH9PXBNF8S3AQ8A`:**

1. **C10** — `POST /v1/orders/{id}/refund` com `transactions[].amount: 50.00` → HTTP **201**, order `partially_refunded`, `refunded_amount: 50.00`.
2. **C09 (1ª tentativa)** — `POST` mesmo endpoint, corpo vazio, **nova** `X-Idempotency-Key` → HTTP **409**, corpo `errors[].message: "Conflict"` (sem código específico no corpo desta resposta).
3. **C09 (2ª tentativa)** — `POST` corpo vazio, **outra** `X-Idempotency-Key` → HTTP **201**, order `refunded`, `refunded_amount: 200.00`.

**Documentação oficial:** a referência de erros cita `409` para `refund_in_progress`, `movement_operations_pending` e cenários de refund concorrente ([integration errors](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/integration-errors/api)). **Não** descreve explicitamente “aguardar após parcial antes do total com corpo vazio”. Classificação: **parcialmente documentado** — hipótese aderente a refund/movements pendentes; corpo genérico `Conflict` deixa subtipo **indeterminado** neste teste.

**Impactos (propostas para E17; sem alterar decisões):**

| Tema | Decisão / spec | Implicação |
| --- | --- | --- |
| Idempotência (D3.15) | Chave persistida por operação financeira | Nova tentativa de estorno total = **nova** chave após 409 transitório; **não** reutilizar chave da 1ª tentativa falha se o MP não persistiu efeito |
| Retry (D3.10) | Timeout/5xx retentável; 409 transitório | Tratar 409 pós-parcial como **técnico retentável** (backoff), distinto de `order_already_refunded` |
| Conciliação (D4.5, D1.20) | Estado financeiro via GET | Após refund, confirmar `refunded`/`partially_refunded` por consulta, não só pelo HTTP do POST |
| Contratos financeiros | E05 | Registrar códigos HTTP e `status_detail` reais para cancelamento/estorno |

## Limitações e comportamentos inesperados

- `expiration_time` não dispara na marca exata do ISO 8601 (polling).
- Checkout: conflito teste/produção com `@testuser.com` no `payer.email` (solução: e-mail genérico + anônimo).
- C07: order `action_required` vs. `failed` na spec interna.
- C09: 409 entre parcial e total com corpo vazio; retry resolve.
- Estornos em produção podem exigir saldo na conta MP (`428 insufficient_money_for_refund` na doc — não observado neste teste).

## Cenários

### C01 — Criar order (Checkout Pro / Orders API)
- **Resultado:** comprovado
- **Decisões:** D3.15, D3.10, billing.md — criar cobrança
- **Comportamento:** Order criada com id, checkout_url e external_reference ecoado.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "POST",
    "caminho": "/v1/orders",
    "external_reference": "cobranca-prova-049c39c1-bf30-4f93-a735-6683d1be4e31",
    "expiration_time": "PT15M",
    "idempotency_key": "[uuid]"
  },
  "resposta": {
    "status_http": 201,
    "duracao_ms": 763,
    "corpo": {
      "id": "ORDTST01M7GFR2A0N4CJ7FWWZZ2W21XM",
      "type": "online",
      "processing_mode": "manual",
      "external_reference": "cobranca-prova-049c39c1-bf30-4f93-a735-6683d1be4e31",
      "total_amount": "150.00",
      "checkout_url": "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORDTST01M7GFR2A0N4CJ7FWWZZ2W21XM&pref_id=3844602487-ffd3675d-5c61-49b7-8d96-4494697a55ce",
      "expiration_time": "PT15M",
      "country_code": "BRA",
      "user_id": "3844602487",
      "status": "created",
      "capture_mode": "automatic_async",
      "client_token": "[redacted]",
      "currency": "BRL",
      "created_date": "2026-11-15T20:52:56.271Z",
      "last_updated_date": "2026-11-15T20:52:56.271Z",
      "integration_data": {
        "application_id": "6090007074819587"
      },
      "items": [
        {
          "title": "Prova técnica E04 — cobrança oficina",
          "unit_price": "150.00",
          "quantity": 1
        }
      ]
    }
  }
}
```
</details>
### C02 — Idempotência na criação (mesma X-Idempotency-Key)
- **Resultado:** comprovado
- **Decisões:** D3.15, D3.11
- **Comportamento:** Segunda chamada retornou o mesmo order id.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "POST",
    "caminho": "/v1/orders",
    "tentativas": 2,
    "mesma_idempotency_key": true
  },
  "resposta": {
    "primeira": {
      "status_http": 201,
      "order_id": "ORDTST01M7GFR2T4VJSW65W5N2TCNQPR"
    },
    "segunda": {
      "status_http": 201,
      "order_id": "ORDTST01M7GFR2T4VJSW65W5N2TCNQPR"
    }
  }
}
```
</details>
### C03 — Consultar order (situação e identificação da cobrança)
- **Resultado:** comprovado
- **Decisões:** D3.10, D4.5, billing.md — confirmar por consulta
- **Comportamento:** Consulta retorna status, external_reference e transações quando existirem.
- **Observações:** Horário efetivo de aprovação: campo a localizar em transactions.payments após pagamento (cenários C06/C07).
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "GET",
    "caminho": "/v1/orders/ORDTST01M7GFR2A0N4CJ7FWWZZ2W21XM"
  },
  "resposta": {
    "status_http": 200,
    "duracao_ms": 149,
    "corpo": {
      "id": "ORDTST01M7GFR2A0N4CJ7FWWZZ2W21XM",
      "type": "online",
      "processing_mode": "manual",
      "external_reference": "cobranca-prova-049c39c1-bf30-4f93-a735-6683d1be4e31",
      "total_amount": "150.00",
      "checkout_url": "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORDTST01M7GFR2A0N4CJ7FWWZZ2W21XM&pref_id=3844602487-ffd3675d-5c61-49b7-8d96-4494697a55ce",
      "expiration_time": "PT15M",
      "country_code": "BRA",
      "user_id": "3844602487",
      "status": "created",
      "capture_mode": "automatic_async",
      "client_token": "[redacted]",
      "currency": "BRL",
      "created_date": "2026-11-15T20:52:56.271Z",
      "last_updated_date": "2026-11-15T20:52:56.271Z",
      "integration_data": {
        "application_id": "6090007074819587"
      },
      "items": [
        {
          "title": "Prova técnica E04 — cobrança oficina",
          "unit_price": "150.00",
          "quantity": 1
        }
      ]
    }
  }
}
```
</details>
### C04 — Cancelar order sem pagamento
- **Resultado:** comprovado
- **Decisões:** D4.5, D1.15, billing.md — POST cancel
- **Comportamento:** Cancelamento de order não paga e consulta subsequente com status canceled.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "POST",
    "caminho": "/v1/orders/ORDTST01M7GFR3JPKJB8TRTDY2J6FQR8/cancel"
  },
  "resposta": {
    "cancelamento": {
      "status_http": 200,
      "corpo": {
        "id": "ORDTST01M7GFR3JPKJB8TRTDY2J6FQR8",
        "type": "online",
        "processing_mode": "manual",
        "external_reference": "cobranca-cancel-1fcff708-2aab-488f-9c00-caee184bf011",
        "total_amount": "102.00",
        "checkout_url": "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORDTST01M7GFR3JPKJB8TRTDY2J6FQR8&pref_id=3844602487-f69d074c-7dcb-4322-b4d4-1a06cb143f76",
        "expiration_time": "PT15M",
        "country_code": "BRA",
        "user_id": "3844602487",
        "status": "canceled",
        "status_detail": "canceled",
        "capture_mode": "automatic_async",
        "currency": "BRL",
        "created_date": "2026-11-15T20:52:57.572Z",
        "last_updated_date": "2026-11-15T20:52:58.018Z",
        "integration_data": {
          "application_id": "6090007074819587"
        },
        "items": [
          {
            "title": "Prova técnica E04 — cobrança oficina",
            "unit_price": "102.00",
            "quantity": 1
          }
        ]
      }
    },
    "consulta": {
      "status_http": 200,
      "status_order": "canceled"
    }
  }
}
```
</details>
### C05b — Limites de expiration_time (incl. PT3M — D4.6 demonstração)
- **Resultado:** comprovado
- **Decisões:** D4.6, D3.11
- **Comportamento:** API aceita valores ISO 8601 usados no projeto; PT3M comprovado ou rejeição documentada.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "POST",
    "caminho": "/v1/orders",
    "valores_testados": [
      "PT3M",
      "PT5M",
      "P1D"
    ]
  },
  "resposta": {
    "tentativas": [
      {
        "expiration_time": "PT3M",
        "status_http": 201,
        "order_id": "ORDTST01M7GFR4DE271NRJJ8HDJCBWDD"
      },
      {
        "expiration_time": "PT5M",
        "status_http": 201,
        "order_id": "ORDTST01M7GFR4V70XMMGVXFRJNTCB4D"
      },
      {
        "expiration_time": "P1D",
        "status_http": 201,
        "order_id": "ORDTST01M7GFR58E5N536QJD005YJ7ZQ"
      }
    ]
  }
}
```
</details>
### C05 — Expiração (expiration_time PT45S)
- **Resultado:** comprovado
- **Decisões:** D4.6, D3.11, billing.md — expirada = canceled
- **Comportamento:** Na 1ª execução (espera 50s) status permaneceu `created`; polling adicional até ~4 min → `canceled` + `status_detail: expired`.
- **Observações:** Limitação: expiração assíncrona, não síncrona no relógio do `expiration_time`. Impacto E19: conciliação periódica (D4.5), não polling fixo de 45s. Script `executar.ts` passou a pollar até 5 min.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "POST",
    "caminho": "/v1/orders",
    "expiration_time": "PT45S"
  },
  "resposta": {
    "consulta_apos_50s": {
      "status_http": 200,
      "status_order": "created",
      "corpo": {
        "id": "ORDTST01M7GFR5N45E6CG8FDJ1F4YYPW",
        "type": "online",
        "processing_mode": "manual",
        "external_reference": "cobranca-exp-aadda37c-740a-42d6-823f-007eef9459b1",
        "total_amount": "103.00",
        "checkout_url": "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORDTST01M7GFR5N45E6CG8FDJ1F4YYPW&pref_id=3844602487-efd1026d-76e3-417e-9688-7395a9874b4e",
        "expiration_time": "PT45S",
        "country_code": "BRA",
        "user_id": "3844602487",
        "status": "created",
        "capture_mode": "automatic_async",
        "client_token": "[redacted]",
        "currency": "BRL",
        "created_date": "2026-11-15T20:52:59.697Z",
        "last_updated_date": "2026-11-15T20:52:59.697Z",
        "integration_data": {
          "application_id": "6090007074819587"
        },
        "items": [
          {
            "title": "Prova técnica E04 — cobrança oficina",
            "unit_price": "103.00",
            "quantity": 1
          }
        ]
      }
    }
  }
}
```
</details>
### C11 — Timeout simulado (AbortSignal)
- **Resultado:** comprovado
- **Decisões:** D3.10, D3.11
- **Comportamento:** Cliente interrompe a requisição antes da resposta; erro classificável como técnico (D3.10).
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "GET",
    "caminho": "/v1/orders/{id}",
    "timeout_ms": 1
  },
  "resposta": {
    "erro": "TimeoutError",
    "duracaoMs": 1
  }
}
```
</details>
### C06 — Pagamento aprovado (cartão de teste APRO)
- **Resultado:** comprovado *(2ª passada; ver tabela e order `ORDTST01M7GH2KEG5AH9PXBNF8S3AQ8A`)*
- **Decisões:** D3.2, D3.11, D4.5
- **Comportamento:** Checkout com titular APRO; GET confirma `processed` / pagamento `accredited`.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "Checkout Pro",
    "caminho": "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORDTST01M7GFSQDE13WR26JA47Q5NB2N&pref_id=3844602487-58c86bfd-105f-42a5-95bf-ab027661979f"
  },
  "resposta": {
    "order_criada": {
      "id": "ORDTST01M7GFSQDE13WR26JA47Q5NB2N",
      "type": "online",
      "processing_mode": "manual",
      "external_reference": "cobranca-aprov-c3914669-4b01-4e36-a601-d5181d71541b",
      "total_amount": "200.00",
      "checkout_url": "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORDTST01M7GFSQDE13WR26JA47Q5NB2N&pref_id=3844602487-58c86bfd-105f-42a5-95bf-ab027661979f",
      "expiration_time": "PT30M",
      "country_code": "BRA",
      "user_id": "3844602487",
      "status": "created",
      "capture_mode": "automatic_async",
      "client_token": "[redacted]",
      "currency": "BRL",
      "created_date": "2026-11-15T20:53:50.653Z",
      "last_updated_date": "2026-11-15T20:53:50.653Z",
      "integration_data": {
        "application_id": "6090007074819587"
      },
      "items": [
        {
          "title": "Prova técnica E04 — cobrança oficina",
          "unit_price": "200.00",
          "quantity": 1
        }
      ]
    },
    "instrucao": "Abra checkout_url, pague com cartão teste e titular APRO; exporte MP_ORDER_PAGA_ID e rode de novo."
  }
}
```
</details>
### C07 — Pagamento recusado (cartão de teste FUND)
- **Resultado:** comprovado *(ver § C07 — `action_required` / `waiting_retry`)*
- **Decisões:** D1.15, D3.11, billing.md — recusa
- **Comportamento:** Order permanece com `checkout_url`; pagamento `failed` / `insufficient_amount`.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{
  "requisicao": {
    "metodo": "Checkout Pro",
    "caminho": "titular FUND"
  },
  "resposta": {
    "status_order": "created",
    "corpo": {
      "id": "ORDTST01M7GFSR0ZKWRK4CDSR7Q2WGG9",
      "type": "online",
      "processing_mode": "manual",
      "external_reference": "cobranca-recus-52f5ee06-a50b-456d-88f2-f68440431c37",
      "total_amount": "201.00",
      "checkout_url": "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORDTST01M7GFSR0ZKWRK4CDSR7Q2WGG9&pref_id=3844602487-39bf2557-a007-423e-8c7c-817edaf8b2ad",
      "expiration_time": "PT30M",
      "country_code": "BRA",
      "user_id": "3844602487",
      "status": "created",
      "capture_mode": "automatic_async",
      "client_token": "[redacted]",
      "currency": "BRL",
      "created_date": "2026-11-15T20:53:51.277Z",
      "last_updated_date": "2026-11-15T20:53:51.277Z",
      "integration_data": {
        "application_id": "6090007074819587"
      },
      "items": [
        {
          "title": "Prova técnica E04 — cobrança oficina",
          "unit_price": "201.00",
          "quantity": 1
        }
      ]
    }
  }
}
```
</details>
### C08 — Tentar cancelar order já paga
- **Resultado:** comprovado *(HTTP 409 `cannot_cancel_order`)*
- **Decisões:** D4.5, billing.md
- **Comportamento:** `POST /cancel` em order `processed` retorna 409; cancelamento não presume estorno.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{}
```
</details>
### C09 — Estorno total
- **Resultado:** comprovado *(ver § C09 — 409 genérico e 2ª tentativa com nova chave)*
- **Decisões:** D1.20, D3.11, D3.15
- **Comportamento:** Estorno total após parcial; retry com nova `X-Idempotency-Key`.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{}
```
</details>
### C10 — Estorno parcial
- **Resultado:** comprovado *(R$ 50 → `partially_refunded`)*
- **Decisões:** D1.20, D2.17
- **Comportamento:** `POST /refund` com valor parcial antes do total.
<details>
<summary>Requisição/resposta sanitizadas</summary>
```json
{}
```
</details>
## Impactos em contratos e decisões

| Decisão | Evidência E04 | Nota para implementação |
| --- | --- | --- |
| **D3.15** | Só Orders API | Sem Preferências |
| **D3.10** | Timeout, idempotência criação, retry refund 409 | Erro técnico vs. negócio em métricas (D7.3) |
| **D3.11** | 12/12 exceto webhook | Portão D3.15 **não** acionado |
| **D1.15** | C07 retentável (`waiting_retry`) | Nova order/chave conforme `billing.md` |
| **D1.20** | C09/C10 sequência parcial→total | Retry + GET para conciliar |
| **D4.5 / D4.6** | C05/C05b | Polling expiração; PT3M aceito |
| **Contratos `billing.*`** | Status reais na API (E04) | Fechados na E05 (`docs/contratos/exemplos/`, `RELATORIO-E05.md`) |

## Pendências encerradas na E05

- Webhook, contratos e política de idempotência pós-409: ver `prova-tecnica/RELATORIO-E05.md`.
