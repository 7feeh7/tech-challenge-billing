import { randomUUID } from 'node:crypto';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_PAGAMENTO_CONFIRMADO,
  type PayloadPagamentoConfirmado,
} from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { interpretarSituacaoFinanceira } from '../../domain/interpretar-situacao-order';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import type { TentativaRecusaGateway } from '../ports/tentativa-recusa.gateway';
import type { ReemitirOrderMercadoPagoService } from './reemitir-order-mercado-pago.service';
import type { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

export class ConciliarCobrancaService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly tentativas: TentativaRecusaGateway,
    private readonly outbox: OutboxGateway,
    private readonly reemitir: ReemitirOrderMercadoPagoService,
    private readonly pagamentoTardio: TratarPagamentoTardioService,
  ) {}

  async conciliarPorCobrancaId(cobrancaId: string): Promise<void> {
    const cobranca = await this.cobrancas.buscarPorId(cobrancaId);
    if (!cobranca?.id) return;
    const posseAte = this.posseReivindicacaoAtiva(cobranca);

    if (cobranca.jaPaga()) {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    const order = await this.orders.buscarAtivaPorCobrancaId(cobrancaId);
    if (!order) {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    const consulta = await this.mercadoPago.consultarOrder(
      order.mercadoPagoOrderId,
    );
    if (consulta.tipo === 'indeterminado') {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    const interpretacao = interpretarSituacaoFinanceira(consulta.order);

    const acaoAposCommit = await this.unitOfWork.executar(async (ctx) => {
      let pedidoReemissao: {
        cobrancaId: string;
        posseAte: Date | null;
      } | null = null;
      let pedidoPagamentoTardio = false;
      const atual = await this.cobrancas.buscarPorId(cobrancaId);
      if (!atual?.id) return { pedidoReemissao, pedidoPagamentoTardio };

      if (order.id) {
        await this.orders.atualizarSituacao(
          ctx,
          order.id,
          consulta.order.status ?? null,
          consulta.order.statusDetail ?? null,
        );
      }

      if (atual.jaPaga()) {
        atual.liberarBloqueioConciliacao();
        await this.gravarCobranca(ctx, cobrancaId, atual, posseAte);
        return { pedidoReemissao, pedidoPagamentoTardio };
      }

      if (interpretacao.tipo === 'paga') {
        if (
          this.pagamentoTardio.deveTratarPagamentoTardio(
            atual,
            interpretacao.aprovadoEm,
          )
        ) {
          pedidoPagamentoTardio = true;
          const pendente = this.clonar(atual);
          pendente.liberarBloqueioConciliacao();
          await this.gravarCobranca(ctx, cobrancaId, pendente, posseAte);
          return { pedidoReemissao, pedidoPagamentoTardio };
        }
        const copia = this.clonar(atual);
        copia.confirmarPagamento(interpretacao.aprovadoEm);
        if (!(await this.gravarCobranca(ctx, cobrancaId, copia, posseAte))) {
          return { pedidoReemissao, pedidoPagamentoTardio };
        }

        const eventId = randomUUID();
        const envelope: EnvelopeMensagem<PayloadPagamentoConfirmado> = {
          eventId,
          eventType: EVENTO_PAGAMENTO_CONFIRMADO,
          version: 1,
          occurredAt: new Date().toISOString(),
          source: 'billing',
          correlationId: atual.correlationId,
          causationId: null,
          ordemServicoId: atual.ordemServicoId,
          rodada: atual.rodada,
          payload: {
            cobrancaId: atual.id,
            orderId: order.mercadoPagoOrderId,
            aprovadoEm: interpretacao.aprovadoEm.toISOString(),
            valorCentavos: atual.valorTotalCentavos,
          },
        };

        await this.outbox.registrar(ctx, {
          eventId,
          eventType: EVENTO_PAGAMENTO_CONFIRMADO,
          envelope,
          correlationId: atual.correlationId,
          destino: DESTINO_FILA_OS,
        });
        return { pedidoReemissao, pedidoPagamentoTardio };
      }

      if (interpretacao.tipo === 'recusada' && order.id) {
        await this.tentativas.registrarSeNova(ctx, {
          cobrancaId,
          orderMercadoPagoId: order.id,
          paymentIdMercadoPago: interpretacao.paymentId,
          motivo: interpretacao.motivo,
        });
        const copia = this.clonar(atual);
        copia.liberarBloqueioConciliacao();
        await this.gravarCobranca(ctx, cobrancaId, copia, posseAte);
        return { pedidoReemissao, pedidoPagamentoTardio };
      }

      if (interpretacao.tipo === 'encerrada_sem_pagamento') {
        if (atual.aindaNoPrazo() && order.id) {
          await this.orders.desativar(ctx, order.id);
        }
        const copia = this.clonar(atual);
        copia.liberarBloqueioConciliacao();
        await this.gravarCobranca(ctx, cobrancaId, copia, posseAte);

        if (
          atual.aindaNoPrazo() &&
          atual.situacao === SituacaoCobranca.PENDENTE
        ) {
          pedidoReemissao = { cobrancaId, posseAte };
        }
        return { pedidoReemissao, pedidoPagamentoTardio };
      }

      const pendente = this.clonar(atual);
      pendente.liberarBloqueioConciliacao();
      await this.gravarCobranca(ctx, cobrancaId, pendente, posseAte);
      return { pedidoReemissao, pedidoPagamentoTardio };
    });

    if (acaoAposCommit.pedidoPagamentoTardio && order.id) {
      await this.pagamentoTardio.tratar({
        cobrancaId,
        posseAte,
        orderId: order.id,
        mercadoPagoOrderId: order.mercadoPagoOrderId,
        aprovadoEm:
          interpretacao.tipo === 'paga' ? interpretacao.aprovadoEm : new Date(),
        orderConsultada: consulta.order,
      });
      return;
    }

    if (acaoAposCommit.pedidoReemissao) {
      await this.reemitir.executar(
        acaoAposCommit.pedidoReemissao.cobrancaId,
        acaoAposCommit.pedidoReemissao.posseAte,
      );
    }
  }

  async conciliarPorMercadoPagoOrderId(
    mercadoPagoOrderId: string,
  ): Promise<Cobranca | null> {
    const cobranca =
      await this.cobrancas.buscarPorMercadoPagoOrderId(mercadoPagoOrderId);
    if (!cobranca?.id) return null;
    await this.conciliarPorCobrancaId(cobranca.id);
    return await this.cobrancas.buscarPorId(cobranca.id);
  }

  private async liberarBloqueio(
    cobranca: Cobranca,
    posseAte: Date | null,
  ): Promise<void> {
    if (!cobranca.id) return;
    await this.unitOfWork.executar(async (ctx) => {
      const copia = this.clonar(cobranca);
      copia.liberarBloqueioConciliacao();
      await this.gravarCobranca(ctx, cobranca.id as string, copia, posseAte);
    });
  }

  private posseReivindicacaoAtiva(cobranca: Cobranca): Date | null {
    const ate = cobranca.bloqueadoConciliacaoAte;
    if (ate && ate.getTime() > Date.now()) return ate;
    return null;
  }

  private async gravarCobranca(
    ctx: ContextoTransacao,
    id: string,
    cobranca: Cobranca,
    posseAte: Date | null,
  ): Promise<boolean> {
    if (posseAte) {
      return this.cobrancas.atualizarSePosse(ctx, id, cobranca, posseAte);
    }
    await this.cobrancas.atualizar(ctx, id, cobranca);
    return true;
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
