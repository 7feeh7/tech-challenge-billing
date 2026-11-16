import { randomUUID } from 'node:crypto';
import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import type { OrderMercadoPagoGateway } from '@/modules/cobrancas/application/ports/order-mercado-pago.gateway';
import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import { SituacaoCobranca } from '@/modules/cobrancas/domain/situacao-cobranca';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_ESTORNO_CONCLUIDO,
  EVENTO_PENDENCIA_RESOLVIDA,
  type PayloadEstornoConcluido,
  type PayloadPendenciaResolvida,
} from '@/shared/messaging/envelope';
import {
  PendenciaEstornoJaResolvidaError,
  PendenciaEstornoNaoEncontradaError,
} from '../../domain/errors/pendencia.errors';
import type {
  DecisaoPendenciaRegistro,
  PendenciaEstornoGateway,
} from '../ports/pendencia-estorno.gateway';

export interface ResolverPendenciaEstornoInput {
  pendenciaId: string;
  responsavelId: string;
  decisao: DecisaoPendenciaRegistro;
  valorEstornadoCentavos?: number;
  justificativa?: string;
}

export class ResolverPendenciaEstornoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly pendencias: PendenciaEstornoGateway,
    private readonly cobrancas: CobrancaGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly outbox: OutboxGateway,
  ) {}

  async execute(input: ResolverPendenciaEstornoInput): Promise<void> {
    const pendencia = await this.pendencias.buscarPorId(input.pendenciaId);
    if (!pendencia) {
      throw new PendenciaEstornoNaoEncontradaError(input.pendenciaId);
    }
    if (pendencia.situacao === 'RESOLVIDA') {
      throw new PendenciaEstornoJaResolvidaError(input.pendenciaId);
    }

    const cobranca = await this.cobrancas.buscarPorId(pendencia.cobrancaId);
    if (!cobranca?.id) {
      throw new PendenciaEstornoNaoEncontradaError(input.pendenciaId);
    }

    const valorEstornado =
      input.decisao === 'SEM_ESTORNO'
        ? 0
        : (input.valorEstornadoCentavos ??
          (input.decisao === 'ESTORNO_INTEGRAL'
            ? pendencia.valorCobrancaCentavos
            : undefined));

    if (
      (input.decisao === 'ESTORNO_INTEGRAL' ||
        input.decisao === 'ESTORNO_PARCIAL') &&
      (valorEstornado === undefined || valorEstornado < 0)
    ) {
      throw new Error(
        'Valor estornado é obrigatório para decisões com estorno.',
      );
    }

    const eventoPendenciaId = randomUUID();
    const eventoEstornoId = randomUUID();

    await this.unitOfWork.executar(async (ctx) => {
      await this.pendencias.resolver(ctx, pendencia.id, {
        responsavelId: input.responsavelId,
        decisao: input.decisao,
        valorEstornadoCentavos: valorEstornado ?? 0,
        justificativa: input.justificativa,
      });

      if (input.decisao !== 'SEM_ESTORNO') {
        const copia = this.clonar(cobranca);
        if (copia.situacao === SituacaoCobranca.PENDENCIA_MANUAL) {
          copia.marcarEstornada();
          await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
        }
      }

      const envelopePendencia: EnvelopeMensagem<PayloadPendenciaResolvida> = {
        eventId: eventoPendenciaId,
        eventType: EVENTO_PENDENCIA_RESOLVIDA,
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: cobranca.correlationId,
        causationId: null,
        ordemServicoId: cobranca.ordemServicoId,
        rodada: cobranca.rodada,
        payload: {
          pendenciaId: pendencia.id,
          decisao: input.decisao,
          valorEstornadoCentavos: valorEstornado ?? 0,
        },
      };

      await this.outbox.registrar(ctx, {
        eventId: eventoPendenciaId,
        eventType: EVENTO_PENDENCIA_RESOLVIDA,
        envelope: envelopePendencia,
        correlationId: cobranca.correlationId,
        destino: DESTINO_FILA_OS,
      });

      if (
        input.decisao === 'ESTORNO_INTEGRAL' ||
        input.decisao === 'ESTORNO_PARCIAL'
      ) {
        const order = await this.orders.buscarUltimaPorCobrancaId(
          cobranca.id as string,
        );
        const envelopeEstorno: EnvelopeMensagem<PayloadEstornoConcluido> = {
          eventId: eventoEstornoId,
          eventType: EVENTO_ESTORNO_CONCLUIDO,
          version: 1,
          occurredAt: new Date().toISOString(),
          source: 'billing',
          correlationId: cobranca.correlationId,
          causationId: eventoPendenciaId,
          ordemServicoId: cobranca.ordemServicoId,
          rodada: cobranca.rodada,
          payload: {
            cobrancaId: cobranca.id as string,
            orderId: order?.mercadoPagoOrderId ?? '',
            valorEstornadoCentavos: valorEstornado ?? 0,
            estornadoEm: new Date().toISOString(),
            tipoEstorno:
              input.decisao === 'ESTORNO_INTEGRAL' ? 'INTEGRAL' : 'PARCIAL',
            statusOrderMercadoPago: 'refunded',
          },
        };

        await this.outbox.registrar(ctx, {
          eventId: eventoEstornoId,
          eventType: EVENTO_ESTORNO_CONCLUIDO,
          envelope: envelopeEstorno,
          correlationId: cobranca.correlationId,
          destino: DESTINO_FILA_OS,
        });
      }
    });
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
