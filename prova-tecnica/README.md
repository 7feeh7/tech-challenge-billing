# Prova técnica E04 — Mercado Pago Orders API

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

- `resultados/execucao-*.json` — respostas sanitizadas
- `RELATORIO.md` — consolidação para E05/E17
