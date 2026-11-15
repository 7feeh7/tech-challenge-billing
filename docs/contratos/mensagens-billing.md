# Mensagens do Billing Service

Dono: Billing (`tech-challenge-billing`). Canal: SQS fila `tech-challenge-producao-billing-in`.

Envelope comum conforme spec Fase 4 `05-communication.md` (não versionada).

Contratos financeiros fechados na E05 conforme evidências da prova técnica (Orders API + webhook).

### Regras observadas na E05 (não alteram decisões arquiteturais)

- **Situação financeira:** a consulta à **Orders API** (`GET /v1/orders/{id}`) é a **autoridade**. O Billing concilia antes de publicar eventos financeiros definitivos.
- **Webhook:** gatilho de conciliação; HMAC comprovada (W01). Entregas incompletas no teste **não** mudam a regra acima.
- **`order.processed`:** pode ocorrer com order ainda `action_required`/`waiting_retry` (W06); decisão financeira vem do GET, não do `action`.
- **INDETERMINADA** (`billing.situacao-financeira.v1`): quando o **GET** não permite confirmar situação ou efeito financeiro (erro, timeout, resposta ambígua, order ausente). Divergência ou **ausência** de webhook, **isoladamente**, **não** caracteriza indeterminada — nestes casos, orientar conciliação por GET/job.
- **Expiração:** `billing.cobranca-expirada.v1` com `canceled`/`expired` observado por GET (W08); webhook de expiração não comprovado no jsonl da prova.
- **Estorno (complemento D3.15):**
  - Interpretar o **código/mensagem específica** do erro (ex.: conflitos de refund).
  - Nas retentativas da **mesma** operação, **preservar** a mesma `X-Idempotency-Key`.
  - **Nova** chave somente com evidência conclusiva de que a operação anterior **não** teve efeito, **não** está em processamento e a API **permite** nova tentativa.
  - `refunded_amount` (ou campos equivalentes) **inalterado**, isoladamente, **não** é evidência suficiente.
  - Resultado **indeterminado** após retentativas: abrir **pendência** e **alerta**; **sem** nova operação automática.
  - Na prova W07, a mesma chave após **409** retornou **201** — a API **não** garante repetir o mesmo HTTP; o efeito comprova-se pelo GET (`refunded`).
- **Deduplicação webhook (`x-request-id`):** cobertura em testes/script; reenvio com mesmo id **não** comprovado no painel (histórico vazio). Não assumir `x-request-id` estável entre reenvios sem prova.

Status MP nos exemplos: valores **observados** na E04/E05 (`processed`, `action_required`, `waiting_retry`, `canceled`, `expired`, `refunded`); recusa no pagamento `failed`/`insufficient_amount`, não como `failed` na order.

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
