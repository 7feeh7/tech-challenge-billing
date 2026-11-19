import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { PendenciaEstornoGateway } from '@/modules/cancelamento-financeiro/application/ports/pendencia-estorno.gateway';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_ESTORNO_CONCLUIDO,
  EVENTO_PAGAMENTO_TARDIO_REGISTRADO,
  type PayloadEstornoConcluido,
  type PayloadPagamentoTardioRegistrado,
  type TratamentoPagamentoTardio,
} from '@/shared/messaging/envelope';
import {
  METRICA_LOG,
  serializarMetricaLog,
} from '@/shared/observability/metrica-log';
import type { Cobranca } from '../../domain/entities/cobranca.entity';
import { interpretarEstornoOrder } from '../../domain/interpretar-estorno-order';
import type { OrderMercadoPagoConsultada } from '../../domain/interpretar-situacao-order';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type {
  EstornoAutomaticoGateway,
  EstornoAutomaticoRegistro,
} from '../ports/estorno-automatico.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import { clonarCobranca } from './clonar-cobranca';

export interface ConfiguracaoEstornoAutomatico {
  maxTentativas: number;
  atrasoRetryMs: number;
  posseMs: number;
}

/**
 * Estorno total de uma order paga que não é o pagamento legítimo da cobrança
 * (segundo pagamento ou pagamento tardio). Cada ciclo consulta a order, repete
 * o pedido com a mesma chave persistida e só conclui com estorno integral
 * confirmado na consulta; esgotadas as tentativas, abre pendência manual.
 */
export class ExecutarEstornoAutomaticoService {
  private readonly logger = new Logger(ExecutarEstornoAutomaticoService.name);

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly estornos: EstornoAutomaticoGateway,
    private readonly cobrancas: CobrancaGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly pendencias: PendenciaEstornoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly outbox: OutboxGateway,
    private readonly configuracao: ConfiguracaoEstornoAutomatico,
  ) {}

  async executar(estornoId: string): Promise<void> {
    const estorno = await this.estornos.reivindicar(
      estornoId,
      this.configuracao.posseMs,
    );
    if (!estorno) return;
    await this.processar(estorno);
  }

  /** Processa um estorno cuja posse já foi reivindicada por quem chama. */
  async processar(estorno: EstornoAutomaticoRegistro): Promise<void> {
    const consultaInicial = await this.mercadoPago.consultarOrder(
      estorno.mercadoPagoOrderId,
    );
    if (consultaInicial.tipo === 'indeterminado') {
      await this.tratarEstornoNaoConfirmado(estorno);
      return;
    }
    if (this.estornoIntegral(consultaInicial.order)) {
      await this.concluir(estorno, consultaInicial.order);
      return;
    }

    // O resultado do pedido não decide nada: só a consulta seguinte prova o
    // estorno, e a mesma chave torna a repetição segura.
    await this.mercadoPago.estornarTotal(
      estorno.mercadoPagoOrderId,
      estorno.chaveIdempotencia,
    );

    const confirmacao = await this.mercadoPago.consultarOrder(
      estorno.mercadoPagoOrderId,
    );
    if (
      confirmacao.tipo === 'sucesso' &&
      this.estornoIntegral(confirmacao.order)
    ) {
      await this.concluir(estorno, confirmacao.order);
      return;
    }

    await this.tratarEstornoNaoConfirmado(estorno);
  }

  /** Libera o estorno para nova tentativa depois de uma falha inesperada. */
  async adiarNovaTentativa(estornoId: string): Promise<void> {
    await this.estornos.adiar(
      estornoId,
      new Date(Date.now() + this.configuracao.atrasoRetryMs),
    );
  }

  private estornoIntegral(order: OrderMercadoPagoConsultada): boolean {
    return interpretarEstornoOrder(order).tipo === 'estorno_integral';
  }

  private async tratarEstornoNaoConfirmado(
    estorno: EstornoAutomaticoRegistro,
  ): Promise<void> {
    const tentativas = await this.estornos.incrementarTentativas(estorno.id);
    if (tentativas >= this.configuracao.maxTentativas) {
      await this.esgotarTentativas(estorno);
      return;
    }
    await this.adiarNovaTentativa(estorno.id);
  }

  private async concluir(
    estorno: EstornoAutomaticoRegistro,
    orderConsultada: OrderMercadoPagoConsultada,
  ): Promise<void> {
    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.estornos.bloquearEmAndamento(ctx, estorno.id);
      if (!atual) return;
      const cobranca = await this.cobrancas.bloquearParaAtualizacao(
        ctx,
        atual.cobrancaId,
      );
      if (!cobranca?.id) return;

      await this.orders.desativar(ctx, atual.orderMercadoPagoId);
      await this.orders.atualizarSituacao(
        ctx,
        atual.orderMercadoPagoId,
        orderConsultada.status ?? null,
        orderConsultada.statusDetail ?? null,
      );
      await this.estornos.concluir(ctx, atual.id);

      if (atual.tipo === 'PAGAMENTO_TARDIO') {
        await this.expirarSePendente(ctx, cobranca);
        await this.publicarPagamentoTardio(
          ctx,
          cobranca,
          atual,
          'ESTORNO_AUTOMATICO',
        );
        return;
      }
      await this.publicarEstornoSegundoPagamento(
        ctx,
        cobranca,
        atual,
        orderConsultada,
      );
    });
  }

  private async esgotarTentativas(
    estorno: EstornoAutomaticoRegistro,
  ): Promise<void> {
    const aberta = await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.estornos.bloquearEmAndamento(ctx, estorno.id);
      if (!atual) return null;
      const cobranca = await this.cobrancas.bloquearParaAtualizacao(
        ctx,
        atual.cobrancaId,
      );
      if (!cobranca?.id) return null;

      const pendencia = await this.pendencias.criar(ctx, {
        cobrancaId: cobranca.id,
        ordemServicoId: cobranca.ordemServicoId,
        rodada: cobranca.rodada,
        valorCobrancaCentavos: atual.valorCentavos,
        motivoAbertura: `Estorno automático não confirmado (${atual.tipo}, order ${atual.mercadoPagoOrderId}) após ${atual.tentativas} tentativas.`,
      });
      await this.estornos.abrirPendenciaManual(ctx, atual.id, pendencia.id);

      if (atual.tipo === 'PAGAMENTO_TARDIO') {
        await this.expirarSePendente(ctx, cobranca);
        await this.publicarPagamentoTardio(
          ctx,
          cobranca,
          atual,
          'PENDENCIA_MANUAL',
        );
      }
      return { cobranca, estorno: atual };
    });
    if (!aberta) return;

    this.sinalizarEstornoIndeterminado(aberta.cobranca, aberta.estorno);
  }

  // Emitidos depois do commit: se a transação falhar, o próximo ciclo repete.
  private sinalizarEstornoIndeterminado(
    cobranca: Cobranca,
    estorno: EstornoAutomaticoRegistro,
  ): void {
    const contexto = {
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      correlationId: cobranca.correlationId,
      operacaoId: estorno.id,
      cobrancaId: cobranca.id,
    };
    this.logger.warn(
      serializarMetricaLog(METRICA_LOG.OPERACAO_FINANCEIRA_INDETERMINADA, {
        ...contexto,
        motivo: 'tentativas_esgotadas',
      }),
    );
    this.logger.warn(
      serializarMetricaLog(METRICA_LOG.PENDENCIA_ESTORNO_ABERTA, {
        ...contexto,
        motivo: `estorno_automatico_${estorno.tipo.toLowerCase()}`,
      }),
    );
  }

  private async expirarSePendente(
    ctx: ContextoTransacao,
    cobranca: Cobranca,
  ): Promise<void> {
    if (cobranca.situacao !== SituacaoCobranca.PENDENTE) return;
    const copia = clonarCobranca(cobranca);
    copia.marcarExpirada();
    await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
  }

  private async publicarPagamentoTardio(
    ctx: ContextoTransacao,
    cobranca: Cobranca,
    estorno: EstornoAutomaticoRegistro,
    tratamento: TratamentoPagamentoTardio,
  ): Promise<void> {
    const eventId = randomUUID();
    const envelope: EnvelopeMensagem<PayloadPagamentoTardioRegistrado> = {
      eventId,
      eventType: EVENTO_PAGAMENTO_TARDIO_REGISTRADO,
      version: 1,
      occurredAt: new Date().toISOString(),
      source: 'billing',
      correlationId: cobranca.correlationId,
      causationId: null,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      payload: {
        cobrancaId: cobranca.id as string,
        orderId: estorno.mercadoPagoOrderId,
        aprovadoEm: estorno.aprovadoEm.toISOString(),
        tratamento,
      },
    };
    await this.outbox.registrar(ctx, {
      eventId,
      eventType: EVENTO_PAGAMENTO_TARDIO_REGISTRADO,
      envelope,
      correlationId: cobranca.correlationId,
      destino: DESTINO_FILA_OS,
    });
  }

  private async publicarEstornoSegundoPagamento(
    ctx: ContextoTransacao,
    cobranca: Cobranca,
    estorno: EstornoAutomaticoRegistro,
    orderConsultada: OrderMercadoPagoConsultada,
  ): Promise<void> {
    const eventId = randomUUID();
    const envelope: EnvelopeMensagem<PayloadEstornoConcluido> = {
      eventId,
      eventType: EVENTO_ESTORNO_CONCLUIDO,
      version: 1,
      occurredAt: new Date().toISOString(),
      source: 'billing',
      correlationId: cobranca.correlationId,
      causationId: null,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      payload: {
        cobrancaId: cobranca.id as string,
        orderId: estorno.mercadoPagoOrderId,
        valorEstornadoCentavos: estorno.valorCentavos,
        estornadoEm: new Date().toISOString(),
        tipoEstorno: 'INTEGRAL',
        statusOrderMercadoPago: orderConsultada.status ?? 'refunded',
        origemEstorno: 'SEGUNDO_PAGAMENTO',
      },
    };
    await this.outbox.registrar(ctx, {
      eventId,
      eventType: EVENTO_ESTORNO_CONCLUIDO,
      envelope,
      correlationId: cobranca.correlationId,
      destino: DESTINO_FILA_OS,
    });
  }
}
