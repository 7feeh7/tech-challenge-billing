# Mensagens do Billing Service

Dono: Billing (`tech-challenge-billing`). Canal: SQS fila `tech-challenge-producao-billing-in`.

Envelope comum conforme spec Fase 4 `05-communication.md` (não versionada).

Contratos financeiros com asterisco em `03-service-boundaries.md` ficam para a etapa E05.

---

## Comandos consumidos (entrada `billing-in`)

| eventType                        | Origem típica |
| -------------------------------- | ------------- |
| `billing.gerar-orcamento.v1`     | OS            |
| `billing.cancelar-financeiro.v1` | OS            |

Exemplos em `exemplos/`.

---

## Eventos publicados (não financeiros)

| eventType                                     | Destino típico |
| --------------------------------------------- | -------------- |
| `billing.orcamento-gerado.v1`                 | OS             |
| `billing.orcamento-rejeitado.v1`              | OS             |
| `billing.resposta-cancelamento-financeiro.v1` | OS             |
| `billing.pendencia-resolvida.v1`              | OS             |

Exemplos em `exemplos/`.
