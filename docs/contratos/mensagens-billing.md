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

---

## Estorno de segundo pagamento e de pagamento tardio

Detalhes do fluxo, da idempotência e das situações da cobrança em [`../estorno-automatico.md`](../estorno-automatico.md).

### `billing.estorno-concluido.v1`: campo aditivo `origemEstorno`

Campo aditivo em `v1` (D3.12), preenchido em toda publicação:

| `origemEstorno`       | Quando                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEGUNDO_PAGAMENTO`   | Estorno automático de uma order paga que não é a que confirmou o pagamento. `orderId` é o da **segunda** order, `tipoEstorno` é sempre `INTEGRAL` e só sai depois de a consulta da order confirmar o estorno integral. |
| `PENDENCIA_RESOLVIDA` | Decisão do ADMINISTRADOR numa pendência manual de estorno (`ESTORNO_INTEGRAL` ou `ESTORNO_PARCIAL`). `orderId` é o da order da pendência.                                                                              |

Exemplos: `billing.estorno-concluido.v1.json` (`SEGUNDO_PAGAMENTO`), `billing.estorno-concluido.pendencia-resolvida.v1.json` (`PENDENCIA_RESOLVIDA`) e `billing.estorno-concluido.sem-origem.v1.json`, o formato anterior ao campo, mantido como compatibilidade: consumidores aceitam a mensagem sem `origemEstorno` e mantêm o comportamento que já tinham.

### `billing.pagamento-confirmado.v1`: campo aditivo `origemPagamento`

Campo aditivo em `v1` (D3.12), preenchido pelo Billing em toda publicação nova. O Billing é a fonte da verdade da classificação, gravada na mesma transação da publicação a partir do que fica persistido:

| `origemPagamento`    | Quando                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAGAMENTO_LEGITIMO` | A order que confirma o pagamento da cobrança, marcada em `orders_mercado_pago.confirmou_pagamento` na mesma transação. Vale para a conciliação (webhook ou periódica) e para a expiração que encontra pagamento dentro do prazo, pois ela delega à conciliação.                                    |
| `SEGUNDO_PAGAMENTO`  | Order paga da mesma cobrança, diferente da que confirmou o pagamento, registrada em `estornos_automaticos` com tipo `SEGUNDO_PAGAMENTO` na mesma transação. `orderId` é o da **segunda** order e a cobrança legítima segue `PAGA`. O OS usa a mensagem para abrir a pendência `SEGUNDO_PAGAMENTO`. |

Com duas orders pagas ao mesmo tempo na mesma cobrança, o bloqueio da linha da cobrança serializa as conciliações: a primeira publica `PAGAMENTO_LEGITIMO` e a segunda publica `SEGUNDO_PAGAMENTO`. Webhook repetido ou conciliação concorrente da mesma order não publicam uma segunda vez.

Exemplos: `billing.pagamento-confirmado.v1.json` (`PAGAMENTO_LEGITIMO`), `billing.pagamento-confirmado.segundo-pagamento.v1.json` (`SEGUNDO_PAGAMENTO`) e `billing.pagamento-confirmado.sem-origem.v1.json`, o formato anterior ao campo, mantido como compatibilidade.

Mensagem legada, sem `origemPagamento`: continua válida em `v1`. O consumidor não pode presumir a origem pelo `orderId`: o OS mantém a classificação própria que já tinha (a da Parte B, pela evidência do estorno e pela ordem de chegada). Valor fora de `PAGAMENTO_LEGITIMO` e `SEGUNDO_PAGAMENTO` é violação de contrato.

### `billing.pagamento-tardio-registrado.v1`: `tratamento`

| `tratamento`         | Quando                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ESTORNO_AUTOMATICO` | Só depois de a consulta da order confirmar o estorno **integral**. Estorno parcial ou indeterminado não publica este valor. |
| `PENDENCIA_MANUAL`   | Esgotadas as tentativas de estorno: pendência manual de estorno aberta, sem estorno concluído.                              |

Exemplos: `billing.pagamento-tardio-registrado.v1.json` (`ESTORNO_AUTOMATICO`) e `billing.pagamento-tardio-registrado.pendencia-manual.v1.json` (`PENDENCIA_MANUAL`).
