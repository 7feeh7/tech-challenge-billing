# Prova técnica — Mercado Pago (E04 API, E05 webhook)

## E04 — Orders API

Scripts isolados de `src/`, sem cobertura Jest nem Sonar (`sonar.sources=src`).

## Configuração local (não versionar segredos)

1. Copie `.env.example` para `.env` nesta pasta.
2. Preencha `MP_ACCESS_TOKEN` (credencial de **teste**, painel Developers).
3. Preencha `MP_PAYER_EMAIL` (usuário comprador de teste).

## Execução

Na raiz do `tech-challenge-billing`:

```bash
yarn prova-tecnica
```

### Pagamentos no Checkout Pro (cenários C06–C10)

A API não conclui cartão via REST. Após criar a order, use o `checkout_url` com [cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/integration-test/test-purchase-with-card):

| Cenário               | Titular no checkout |
| --------------------- | ------------------- |
| Aprovado              | `APRO`              |
| Recusado (sem fundos) | `FUND`              |

Reexecute informando ids já pagos:

```bash
MP_ORDER_PAGA_ID=<id> MP_ORDER_PARCIAL_ID=<id2> yarn prova-tecnica
```

(`MP_ORDER_RECUSADA_ID` opcional para C07.)

## Saídas

- `resultados/execucao-*.json` — respostas sanitizadas (E04)
- `RELATORIO.md` — consolidação E04
- `resultados/webhook-entregas.jsonl` — entregas webhook E05
- `resultados/e05-w06-w08-*.json` — evidências W06–W08
- `RELATORIO-E05.md` — cenários W01–W08, **Saída E05**, limitação W03 (histórico painel vazio)

## E05 — Webhook e contratos

1. Configure `MP_WEBHOOK_SECRET` (igual ao painel) em `prova-tecnica/.env`.
2. Suba o Billing com o mesmo segredo e `MP_WEBHOOK_PROVA_HABILITADA=true`.
3. Túnel só para `/v1/webhooks/mercado-pago` (ver `RELATORIO-E05.md`).
4. Execute:

```bash
yarn prova-tecnica-e05
```

- `RELATORIO-E05.md` — webhook, contratos e decisão D3.15
