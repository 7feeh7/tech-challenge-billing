# Estorno automático: segundo pagamento e pagamento tardio

O Billing estorna sozinho a order paga que **não** é o pagamento legítimo da cobrança. Há dois casos, tratados pelo mesmo mecanismo (`ExecutarEstornoAutomaticoService`, tabela `estornos_automaticos`):

| Caso                | Quando                                                                                                     | O que publica                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEGUNDO_PAGAMENTO` | Order da mesma cobrança, diferente da que confirmou o pagamento, com pagamento aprovado no Mercado Pago.   | `PagamentoConfirmado` da segunda order com `origemPagamento = SEGUNDO_PAGAMENTO` (na transação do registro) e, com estorno integral confirmado, `EstornoConcluido` com `origemEstorno = SEGUNDO_PAGAMENTO`. |
| `PAGAMENTO_TARDIO`  | Pagamento aprovado numa cobrança `EXPIRADA` ou `CANCELADA`, ou depois do prazo de uma cobrança `PENDENTE`. | `PagamentoTardioRegistrado` com `ESTORNO_AUTOMATICO` (estorno integral confirmado) ou `PENDENCIA_MANUAL` (tentativas esgotadas).                                                                            |

Os contratos estão em [`contratos/mensagens-billing.md`](contratos/mensagens-billing.md).

## Order legítima

A order que confirmou o pagamento é marcada em `orders_mercado_pago.confirmou_pagamento`, na mesma transação que passa a cobrança a `PAGA` (ou a `PENDENCIA_MANUAL`, quando o pagamento é revelado durante um cancelamento). Essa marca é a identificação persistente: nenhum fluxo de segundo pagamento estorna essa order, e o cancelamento financeiro e a resolução de pendência passam a usar a order marcada em vez da "ativa" ou da "última". Para cobranças pagas antes da marca existir, `buscarQueConfirmouPagamento` recai na order ativa e, por fim, na mais recente.

A cobrança legítima continua `PAGA` (ou na situação que já tinha) quando um segundo pagamento aparece.

## Idempotência

- Um registro por order: `estornos_automaticos.order_mercado_pago_id` é único e a inserção usa `ON CONFLICT DO NOTHING`. Webhooks repetidos e conciliações concorrentes da mesma order geram um único registro, um único `PagamentoConfirmado` da segunda order (`origemPagamento = SEGUNDO_PAGAMENTO`) e um único estorno.
- A chave de idempotência do estorno (`chave_idempotencia`) nasce com o registro e é reutilizada em toda nova tentativa.
- A conciliação lê a cobrança com `FOR UPDATE`. Com duas orders pagas ao mesmo tempo numa cobrança ainda pendente, a primeira transação confirma o pagamento e a segunda enxerga a cobrança confirmada e registra o segundo pagamento.
- O estorno é reivindicado por posse (`bloqueado_processamento_ate`): só uma instância processa por vez, e a espera entre tentativas usa o mesmo campo.

## Consulta de situação financeira

Com pagamento confirmado, a consulta (prazo de referência e exceção E10) lê a order **legítima**, não a ativa: `orderId`, `aprovadoEm` e a situação do estorno vêm sempre dela. Nas cobranças `ESTORNO_EM_ANDAMENTO`, `ESTORNADA` e `PENDENCIA_MANUAL` a resposta é só leitura da order legítima (`responderPelaOrderLegitima`): nada é cancelado e a order ativa, que pode ser de um segundo pagamento ainda não conciliado, não é consultada. A order de um segundo pagamento (desativada no registro e, depois, estornada) nunca define a resposta.

## Ciclo do estorno

Cada ciclo, inline logo após o registro ou pelo `ProcessadorOperacoesFinanceirasService`:

1. Consulta a order. Estorno integral já confirmado: conclui sem repetir o pedido.
2. Sem estorno (ou parcial): repete `POST /v1/orders/{id}/refund` com a **mesma chave** persistida.
3. Consulta de novo. O resultado do pedido não decide nada: só a consulta com estorno **integral** conclui.
4. Parcial, indeterminado, recusado ou consulta sem resposta: conta a tentativa e adia por `CANCELAMENTO_FINANCEIRO_RETRY_MP_MS`.
5. Ao atingir `CANCELAMENTO_FINANCEIRO_MAX_TENTATIVAS_MP`: abre a pendência manual de estorno (`pendencias_estorno`, ligada ao estorno por `estornos_automaticos.pendencia_id`) e emite os sinais `billing.operacao_financeira_indeterminada` e `billing.pendencia_estorno_aberta`. O segundo pagamento não publica `EstornoConcluido`; o tardio publica `PagamentoTardioRegistrado` com `PENDENCIA_MANUAL`. Sem nova operação financeira automática.

A conclusão e a abertura da pendência acontecem numa transação que relê o estorno com `FOR UPDATE`, desativa a order, grava o estado e registra a mensagem na outbox.

## Resolução da pendência

`POST /v1/pendencias-estorno/{id}/resolucao` continua só do ADMINISTRADOR. Para pendência de estorno automático, `EstornoConcluido` leva o `orderId` da order estornada, `origemEstorno = PENDENCIA_RESOLVIDA`, e a situação da cobrança não muda (ela pertence à order legítima).

## Situações da cobrança × order paga

| Situação da cobrança                                         | Order paga que aparece                        | Tratamento                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAGA`                                                       | Outra order da cobrança                       | Segundo pagamento.                                                                                                                                                                                                                  |
| `ESTORNO_EM_ANDAMENTO` (cancelamento estornando a legítima)  | Outra order da cobrança                       | Segundo pagamento, estornado à parte; o estorno do cancelamento segue só na order legítima.                                                                                                                                         |
| `ESTORNADA` (a legítima já foi estornada)                    | Outra order da cobrança                       | Segundo pagamento.                                                                                                                                                                                                                  |
| `PENDENCIA_MANUAL` (a legítima aguarda decisão manual)       | Outra order da cobrança                       | Segundo pagamento: só a legítima fica na pendência; a segunda é estornada automaticamente.                                                                                                                                          |
| `PENDENTE`, pagamento dentro do prazo                        | A primeira order paga (ativa ou anterior)     | Pagamento normal: confirma a cobrança com a order avisada e a marca como legítima.                                                                                                                                                  |
| `PENDENTE`, duas orders pagas ao mesmo tempo                 | A segunda a confirmar (ordem do `FOR UPDATE`) | A primeira confirma (`PagamentoConfirmado` com `PAGAMENTO_LEGITIMO`); a segunda é segundo pagamento (`PagamentoConfirmado` com `SEGUNDO_PAGAMENTO` e estorno).                                                                      |
| `PENDENTE`, pagamento dentro do prazo, visto só na expiração | A order ativa                                 | A expiração aplica a mesma regra da conciliação (`deveTratarPagamentoTardio`, pelo `aprovadoEm`): confirma o pagamento normalmente, com `PagamentoConfirmado` (`PAGAMENTO_LEGITIMO`), e marca a order como legítima. Nunca estorna. |
| `PENDENTE`, pagamento depois do prazo                        | Order ativa                                   | Pagamento tardio.                                                                                                                                                                                                                   |
| `EXPIRADA` ou `CANCELADA`                                    | Order ativa ou já desativada                  | Pagamento tardio (o webhook consulta a order avisada mesmo desativada).                                                                                                                                                             |
| `INTENCAO`, com order registrada                             | Order da cobrança                             | Pagamento tardio: a criação da order perdeu a posse depois de gravar a order e a cobrança nunca chegou a `PENDENTE`. Sem order registrada, o webhook é ignorado (não há como ligar a order à cobrança).                             |

Em todos os casos há estorno automático ou pendência manual de estorno: nenhum pagamento fica sem um dos dois.

## Retomada de `ESTORNO_EM_ANDAMENTO` no cancelamento financeiro

Estorno de `CancelarFinanceiro` com resultado indeterminado deixa a cobrança em `ESTORNO_EM_ANDAMENTO`. A cada ciclo do processador a operação consulta a order da legítima: estorno integral confirmado conclui com `ESTORNADA`; sem estorno repete o pedido com a mesma chave da operação; esgotadas as tentativas, abre a pendência manual, responde `PENDENCIA_MANUAL_ABERTA` e emite o sinal de operação indeterminada. A mesma regra vale para cobrança `INTENCAO`, `PENDENTE` ou `EXPIRADA` com order ativa, sempre com a operação respondida ao OS:

- **Pagamento revelado na consulta:** a cobrança vai a `PENDENCIA_MANUAL`, o horário de aprovação é registrado e a order é marcada como a legítima.
- **Pagamento não revelado (consulta indeterminada ou sem pagamento):** a pendência é aberta e a cobrança **não muda de situação**. Marcá-la `PENDENCIA_MANUAL` sem pagamento esconderia um pagamento posterior (a conciliação não geraria `PagamentoConfirmado`) e faria outra order paga ser estornada como segundo pagamento. Mantida `INTENCAO`, `PENDENTE` ou `EXPIRADA`, um pagamento real posterior segue o fluxo normal: `PENDENTE` no prazo confirma e publica `PagamentoConfirmado`; `EXPIRADA`, `CANCELADA`, `INTENCAO` ou depois do prazo é estornado como pagamento tardio. Um reprocesso reaproveita sempre a pendência já aberta do cancelamento (`buscarAbertaPorCobrancaId`, que ignora as pendências de estorno automático), com ou sem pagamento revelado: se o reprocesso revelar o pagamento, a cobrança recebe a situação coerente (`PENDENCIA_MANUAL`, horário e order legítima) sem abrir outra pendência.
- **Order já em estorno automático:** o cancelamento nunca a trata como pagamento legítimo nem revelado. Com o estorno `EM_ANDAMENTO`, a operação espera (sem contar tentativa) até o desfecho; com o estorno em `PENDENCIA_MANUAL`, responde `PENDENCIA_MANUAL_ABERTA` com a pendência desse estorno, sem abrir outra e sem estornar de novo; concluído o estorno, a order já está desativada e o cancelamento segue normalmente. Ao resolver a pendência de um estorno automático, o resolver desativa a order estornada: o cancelamento deixa de encontrá-la como ativa e segue o fluxo normal (sem segundo estorno, sem pendência nova).

### Resolução de pendência sem pagamento confirmado

`ESTORNO_INTEGRAL` e `ESTORNO_PARCIAL` só são aceitos quando a cobrança tem pagamento confirmado (`PAGA`, `ESTORNO_EM_ANDAMENTO`, `ESTORNADA` ou `PENDENCIA_MANUAL`) ou a pendência pertence a um estorno automático. Para cobrança sem pagamento confirmado só `SEM_ESTORNO` é aceito; a outra decisão responde 409 (`PendenciaEstornoSemPagamentoError`) e não publica `EstornoConcluido`. Se o pagamento chegar depois, a cobrança passa a `PAGA` e a decisão de estorno fica permitida.

## Isolamento dos lotes

Os processadores em lote tratam cada item em `try/catch`: o erro de um não interrompe os demais. Operações financeiras e estornos automáticos com falha são adiados por `CANCELAMENTO_FINANCEIRO_RETRY_MP_MS` e continuam `EM_ANDAMENTO`, de modo que a resposta ao OS não se perde. Cobranças e orçamentos reivindicados voltam ao lote quando a posse expira. O log de falha está descrito em [`metricas-de-log.md`](metricas-de-log.md).

## Migration

`0007_segundo_pagamento_estorno_automatico` é aditiva: acrescenta `orders_mercado_pago.confirmou_pagamento` (padrão `false`) e a tabela `estornos_automaticos`, sem alterar dados existentes.
