# Mensagens do Billing Service

Dono: Billing (`tech-challenge-billing`). Canal: SQS fila `tech-challenge-producao-billing-in`.

Envelope comum conforme spec Fase 4 `05-communication.md` (não versionada).

Contratos financeiros fechados na E05 conforme evidências da prova técnica (Orders API + webhook).

### Regras observadas na E05 (não alteram decisões arquiteturais)

- **Fonte de verdade financeira:** `GET /v1/orders/{id}` após gatilho (webhook ou job). O Billing **deve** conciliar antes de publicar eventos financeiros definitivos.
- **Webhook:** notificação `orders_v2` com HMAC comprovada (W01); entregas **incompletas** no ambiente teste (muitas transições só apareceram no GET). Usar webhook como **gatilho**, não como estado final.
- **`order.processed`:** pode chegar com order ainda `action_required`/`waiting_retry` após recusa (W06); não inferir pagamento só pelo `action`.
- **Expiração:** exemplo `billing.cobranca-expirada.v1` com `canceled`/`expired` comprovado por GET (W08); webhook de expiração **não** registrado no jsonl da prova.
- **Estorno:** exemplos com `refunded`/`refunded` (W07). Após estorno parcial, estorno total pode retornar **409**; reutilizar a mesma `X-Idempotency-Key` **não** garantiu repetir o mesmo HTTP (409 depois 201 na prova) — **sempre** confirmar efeito pelo GET antes de nova chave ou nova operação.
- **Deduplicação de webhook (`x-request-id`):** dedup em memória na prova e cobertura por testes/script; **não** comprovado reenvio com mesmo id no painel (histórico vazio). Não tratar `x-request-id` como identificador estável de reenvio até validação explícita.
- **Situação indeterminada:** usar `billing.situacao-financeira.v1` com `INDETERMINADA` quando webhook e GET divergirem ou faltar entrega.

Status MP nos exemplos: valores **observados** na E04/E05 (`processed`, `action_required`, `waiting_retry`, `canceled`, `expired`, `refunded`); recusa materializada no pagamento `failed`/`insufficient_amount`, não como `failed` na order.

---

## Comandos consumidos (entrada `billing-in`)

| eventType                        | Origem típica |
| -------------------------------- | ------------- |
| `billing.gerar-orcamento.v1`     | OS            |
| `billing.cancelar-financeiro.v1` | OS            |

Exemplos em `exemplos/`.

---

## Eventos publicados

| eventType                                     | Destino típico | Financeiro |
| --------------------------------------------- | -------------- | ---------- |
| `billing.orcamento-gerado.v1`                 | OS             | não        |
| `billing.orcamento-rejeitado.v1`              | OS             | não        |
| `billing.resposta-cancelamento-financeiro.v1` | OS             | não        |
| `billing.pendencia-resolvida.v1`              | OS             | não        |
| `billing.cobranca-criada.v1`                  | OS             | sim        |
| `billing.pagamento-confirmado.v1`             | OS             | sim        |
| `billing.cobranca-expirada.v1`                | OS             | sim        |
| `billing.pagamento-tardio-registrado.v1`      | OS             | sim        |
| `billing.estorno-concluido.v1`                | OS             | sim        |
| `billing.situacao-financeira.v1`              | OS             | sim        |

## Comandos financeiros consumidos

| eventType                                  | Origem |
| ------------------------------------------ | ------ |
| `billing.consultar-situacao-financeira.v1` | OS     |

Exemplos em `exemplos/` (dois exemplos de `billing.situacao-financeira.v1`: sucesso e indeterminada).
