import { randomUUID } from 'node:crypto';
import { mapearSituacaoEstornoConsulta } from '@/modules/cobrancas/application/mapear-situacao-estorno-consulta';
import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import type { MercadoPagoGateway } from '@/modules/cobrancas/application/ports/mercado-pago.gateway';
import type { OrderMercadoPagoGateway } from '@/modules/cobrancas/application/ports/order-mercado-pago.gateway';
import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import { interpretarSituacaoFinanceira } from '@/modules/cobrancas/domain/interpretar-situacao-order';
import { SituacaoCobranca } from '@/modules/cobrancas/domain/situacao-cobranca';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_SITUACAO_FINANCEIRA,
  type FinalidadeConsultaSituacaoFinanceira,
  type PayloadSituacaoFinanceira,
  type SituacaoPagamentoConsulta,
} from '@/shared/messaging/envelope';
import type { PendenciaFinanceiraMonitorGateway } from '@/shared/observability/pendencia-financeira-monitor.gateway';
import type {
  OperacaoFinanceiraGateway,
  OperacaoFinanceiraRegistro,
} from '../ports/operacao-financeira.gateway';

export class ExecutarConsultaSituacaoFinanceiroService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly operacoes: OperacaoFinanceiraGateway,
    private readonly cobrancas: CobrancaGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly outbox: OutboxGateway,
    private readonly monitor: PendenciaFinanceiraMonitorGateway,
    private readonly maxTentativasMercadoPago: number,
    private readonly atrasoRetryMercadoPagoMs: number,
  ) {}

  async executar(operacaoId: string): Promise<void> {
    const operacao = await this.operacoes.buscarPorId(operacaoId);
    if (
      !operacao ||
      operacao.situacao !== 'EM_ANDAMENTO' ||
      operacao.tipo !== 'CONSULTA_SITUACAO_FINANCEIRA'
    ) {
      return;
    }

    const cobranca = await this.cobrancas.buscarPorOrdemServicoERodada(
      operacao.ordemServicoId,
      operacao.rodada,
    );

    if (!cobranca?.id) {
      await this.responder(
        operacao,
        'INDETERMINADA',
        'NENHUM',
        null,
        null,
        null,
      );
      return;
    }

    const finalidade =
      operacao.finalidadeConsulta as FinalidadeConsultaSituacaoFinanceira;

    if (finalidade === 'EXCECAO_E10') {
      await this.responderLeitura(operacao, cobranca);
      return;
    }

    await this.responderComEfeito(operacao, cobranca);
  }

  private async responderLeitura(
    operacao: OperacaoFinanceiraRegistro,
    cobranca: Cobranca,
  ): Promise<void> {
    const order = await this.orders.buscarAtivaPorCobrancaId(
      cobranca.id as string,
    );
    if (!order) {
      const situacao = this.inferirSemOrder(cobranca);
      await this.responder(
        operacao,
        situacao.pagamento,
        situacao.estorno,
        cobranca,
        null,
        null,
      );
      return;
    }

    const consulta = await this.mercadoPago.consultarOrder(
      order.mercadoPagoOrderId,
    );
    if (consulta.tipo === 'indeterminado') {
      await this.registrarIndeterminada(operacao, cobranca, consulta.motivo);
      return;
    }

    const { pagamento, estorno } = this.avaliarOrder(
      cobranca,
      consulta.order,
      consulta.order.pagamentos.find((p) => p.dateApproved)?.dateApproved
        ? new Date(
            consulta.order.pagamentos.find((p) => p.dateApproved)
              ?.dateApproved as string,
          )
        : null,
    );

    await this.responder(
      operacao,
      pagamento,
      estorno,
      cobranca,
      order.mercadoPagoOrderId,
      cobranca.pagamentoConfirmadoEm,
    );
  }

  private async responderComEfeito(
    operacao: OperacaoFinanceiraRegistro,
    cobranca: Cobranca,
  ): Promise<void> {
    if (cobranca.jaPaga() && cobranca.pagamentoConfirmadoEm) {
      const order = await this.orders.buscarAtivaPorCobrancaId(
        cobranca.id as string,
      );
      if (order) {
        const consulta = await this.mercadoPago.consultarOrder(
          order.mercadoPagoOrderId,
        );
        const estorno =
          consulta.tipo === 'sucesso'
            ? mapearSituacaoEstornoConsulta({
                order: consulta.order,
                situacaoCobranca: cobranca.situacao,
              })
            : 'INDETERMINADO';

        if (
          cobranca.pagamentoConfirmadoEm.getTime() <=
          cobranca.prazoPagamento.getTime()
        ) {
          await this.responder(
            operacao,
            'PAGO_NO_PRAZO',
            estorno,
            cobranca,
            order.mercadoPagoOrderId,
            cobranca.pagamentoConfirmadoEm,
          );
          return;
        }
      }
    }

    const order = await this.orders.buscarAtivaPorCobrancaId(
      cobranca.id as string,
    );
    if (order) {
      const consulta = await this.mercadoPago.consultarOrder(
        order.mercadoPagoOrderId,
      );
      if (consulta.tipo === 'indeterminado') {
        await this.registrarIndeterminada(operacao, cobranca, consulta.motivo);
        return;
      }

      const interpretacao = interpretarSituacaoFinanceira(consulta.order);
      if (interpretacao.tipo === 'paga') {
        if (
          interpretacao.aprovadoEm.getTime() <=
          cobranca.prazoPagamento.getTime()
        ) {
          await this.responder(
            operacao,
            'PAGO_NO_PRAZO',
            mapearSituacaoEstornoConsulta({
              order: consulta.order,
              situacaoCobranca: cobranca.situacao,
            }),
            cobranca,
            order.mercadoPagoOrderId,
            interpretacao.aprovadoEm,
          );
          return;
        }
      }
    }

    if (!order) {
      if (
        cobranca.situacao === SituacaoCobranca.EXPIRADA ||
        cobranca.situacao === SituacaoCobranca.CANCELADA
      ) {
        await this.responder(
          operacao,
          'SEM_PAGAMENTO',
          'NENHUM',
          cobranca,
          null,
          null,
        );
        return;
      }
      await this.responder(
        operacao,
        'INDETERMINADA',
        'INDETERMINADO',
        cobranca,
        null,
        null,
      );
      return;
    }

    const cancelamento = await this.mercadoPago.cancelarOrder(
      order.mercadoPagoOrderId,
      order.chaveIdempotencia,
    );
    if (cancelamento.tipo === 'indeterminado') {
      await this.registrarIndeterminada(
        operacao,
        cobranca,
        cancelamento.motivo,
      );
      return;
    }

    const confirmacao = await this.mercadoPago.consultarOrder(
      order.mercadoPagoOrderId,
    );
    if (confirmacao.tipo === 'indeterminado') {
      await this.registrarIndeterminada(operacao, cobranca, confirmacao.motivo);
      return;
    }

    const situacao = interpretarSituacaoFinanceira(confirmacao.order);
    if (situacao.tipo === 'encerrada_sem_pagamento') {
      await this.unitOfWork.executar(async (ctx) => {
        if (cobranca.situacao === SituacaoCobranca.PENDENTE) {
          const copia = this.clonar(cobranca);
          copia.marcarExpirada();
          await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
        }
        if (order.id) {
          await this.orders.desativar(ctx, order.id);
        }
      });
      await this.responder(
        operacao,
        'SEM_PAGAMENTO',
        'NENHUM',
        cobranca,
        order.mercadoPagoOrderId,
        null,
      );
      return;
    }

    if (situacao.tipo === 'paga') {
      await this.registrarIndeterminada(
        operacao,
        cobranca,
        'pagamento detectado após tentativa de cancelamento',
      );
      return;
    }

    await this.registrarIndeterminada(
      operacao,
      cobranca,
      situacao.tipo === 'indeterminada'
        ? situacao.motivo
        : `situacao_order_${situacao.tipo}`,
    );
  }

  private avaliarOrder(
    cobranca: Cobranca,
    order: Parameters<typeof interpretarSituacaoFinanceira>[0],
    aprovadoEm: Date | null,
  ): {
    pagamento: SituacaoPagamentoConsulta;
    estorno: PayloadSituacaoFinanceira['situacaoEstorno'];
  } {
    const interpretacao = interpretarSituacaoFinanceira(order);
    const estorno = mapearSituacaoEstornoConsulta({
      order,
      situacaoCobranca: cobranca.situacao,
    });

    if (interpretacao.tipo === 'paga' && aprovadoEm) {
      if (aprovadoEm.getTime() <= cobranca.prazoPagamento.getTime()) {
        return { pagamento: 'PAGO_NO_PRAZO', estorno };
      }
      return { pagamento: 'SEM_PAGAMENTO', estorno };
    }

    if (
      cobranca.situacao === SituacaoCobranca.EXPIRADA ||
      cobranca.situacao === SituacaoCobranca.CANCELADA ||
      interpretacao.tipo === 'encerrada_sem_pagamento'
    ) {
      return { pagamento: 'SEM_PAGAMENTO', estorno };
    }

    return { pagamento: 'INDETERMINADA', estorno: 'INDETERMINADO' };
  }

  private inferirSemOrder(cobranca: Cobranca): {
    pagamento: SituacaoPagamentoConsulta;
    estorno: PayloadSituacaoFinanceira['situacaoEstorno'];
  } {
    if (cobranca.jaPaga() && cobranca.pagamentoConfirmadoEm) {
      if (
        cobranca.pagamentoConfirmadoEm.getTime() <=
        cobranca.prazoPagamento.getTime()
      ) {
        return { pagamento: 'PAGO_NO_PRAZO', estorno: 'NENHUM' };
      }
    }
    if (
      cobranca.situacao === SituacaoCobranca.EXPIRADA ||
      cobranca.situacao === SituacaoCobranca.CANCELADA
    ) {
      return { pagamento: 'SEM_PAGAMENTO', estorno: 'NENHUM' };
    }
    return { pagamento: 'INDETERMINADA', estorno: 'INDETERMINADO' };
  }

  private async responder(
    operacao: OperacaoFinanceiraRegistro,
    situacaoPagamento: SituacaoPagamentoConsulta,
    situacaoEstorno: PayloadSituacaoFinanceira['situacaoEstorno'],
    cobranca: Cobranca | null,
    orderId: string | null,
    aprovadoEm: Date | null,
  ): Promise<void> {
    if (situacaoPagamento !== 'INDETERMINADA') {
      await this.monitor.resolverPorOperacao(operacao.id);
    }

    const eventId = randomUUID();
    await this.unitOfWork.executar(async (ctx) => {
      await this.operacoes.concluirConsulta(ctx, operacao.id, {
        cobrancaId: cobranca?.id ?? null,
        resultadoConsulta: situacaoPagamento,
      });

      if (!cobranca?.id || !operacao.consultaId) return;

      const payload: PayloadSituacaoFinanceira = {
        consultaId: operacao.consultaId,
        situacaoPagamento,
        situacaoEstorno,
        cobrancaId: cobranca.id,
        ...(orderId ? { orderId } : {}),
        ...(aprovadoEm ? { aprovadoEm: aprovadoEm.toISOString() } : {}),
        ...(cobranca.jaPaga()
          ? { valorCentavos: cobranca.valorTotalCentavos }
          : {}),
      };

      const envelope: EnvelopeMensagem<PayloadSituacaoFinanceira> = {
        eventId,
        eventType: EVENTO_SITUACAO_FINANCEIRA,
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: operacao.correlationId,
        causationId: operacao.eventId,
        ordemServicoId: operacao.ordemServicoId,
        rodada: operacao.rodada,
        payload,
      };

      await this.outbox.registrar(ctx, {
        eventId,
        eventType: EVENTO_SITUACAO_FINANCEIRA,
        envelope,
        correlationId: operacao.correlationId,
        destino: DESTINO_FILA_OS,
      });
    });
  }

  private async registrarIndeterminada(
    operacao: OperacaoFinanceiraRegistro,
    cobranca: Cobranca,
    motivo: string,
  ): Promise<void> {
    await this.monitor.registrar({
      tipo: 'SITUACAO_FINANCEIRA_INDETERMINADA',
      operacaoId: operacao.id,
      cobrancaId: cobranca.id,
      ordemServicoId: operacao.ordemServicoId,
      rodada: operacao.rodada,
      correlationId: operacao.correlationId,
      motivo,
    });

    const tentativas = operacao.tentativasMercadoPago + 1;
    await this.operacoes.incrementarTentativasMercadoPago(operacao.id);

    if (tentativas >= this.maxTentativasMercadoPago) {
      await this.responder(
        operacao,
        'INDETERMINADA',
        'INDETERMINADO',
        cobranca,
        null,
        null,
      );
      return;
    }

    await this.operacoes.adiarProcessamento(
      operacao.id,
      new Date(Date.now() + this.atrasoRetryMercadoPagoMs),
    );
  }

  private clonar(cobranca: Cobranca): Cobranca {
    return new Cobranca({
      id: cobranca.id,
      orcamentoId: cobranca.orcamentoId,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      clienteId: cobranca.clienteId,
      correlationId: cobranca.correlationId,
      valorTotalCentavos: cobranca.valorTotalCentavos,
      prazoPagamento: cobranca.prazoPagamento,
      situacao: cobranca.situacao,
      linkPagamento: cobranca.linkPagamento,
      pagamentoConfirmadoEm: cobranca.pagamentoConfirmadoEm,
      bloqueadoConciliacaoAte: cobranca.bloqueadoConciliacaoAte,
      criadoEm: cobranca.criadoEm,
    });
  }
}
