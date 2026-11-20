import { randomUUID } from 'node:crypto';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_COBRANCA_EXPIRADA,
  type PayloadCobrancaExpirada,
} from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { interpretarSituacaoFinanceira } from '../../domain/interpretar-situacao-order';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import type { ConciliarCobrancaService } from './conciliar-cobranca.service';
import { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

export class ExpirarCobrancaService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly outbox: OutboxGateway,
    private readonly pagamentoTardio: TratarPagamentoTardioService,
    private readonly conciliar: ConciliarCobrancaService,
  ) {}

  async expirarPorCobrancaId(cobrancaId: string): Promise<void> {
    const cobranca = await this.cobrancas.buscarPorId(cobrancaId);
    if (!cobranca?.id) return;
    const posseAte = this.posseAtiva(cobranca);

    if (cobranca.situacao !== SituacaoCobranca.PENDENTE) {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    if (!cobranca.prazoVencido()) {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    const order = await this.orders.buscarAtivaPorCobrancaId(cobrancaId);
    if (!order) {
      await this.marcarExpiradaSemOrder(cobranca, posseAte);
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
    if (interpretacao.tipo === 'paga') {
      // Pago dentro do prazo, com o webhook atrasado: é pagamento normal, e
      // estornar a cobrança legítima seria indevido (D4.7).
      if (
        !this.pagamentoTardio.deveTratarPagamentoTardio(
          cobranca,
          interpretacao.aprovadoEm,
        )
      ) {
        await this.conciliar.conciliarPorCobrancaId(cobrancaId, order);
        return;
      }
      await this.pagamentoTardio.tratar({
        cobrancaId,
        posseAte,
        orderId: order.id as string,
        aprovadoEm: interpretacao.aprovadoEm,
      });
      return;
    }

    if (interpretacao.tipo === 'encerrada_sem_pagamento') {
      await this.finalizarExpiracaoConfirmada(
        cobranca,
        posseAte,
        order.id as string,
        order.mercadoPagoOrderId,
        consulta.order.status ?? 'canceled',
        consulta.order.statusDetail ?? 'expired',
      );
      return;
    }

    const cancelamento = await this.mercadoPago.cancelarOrder(
      order.mercadoPagoOrderId,
      order.chaveIdempotencia,
    );
    if (cancelamento.tipo === 'indeterminado') {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    const confirmacao = await this.mercadoPago.consultarOrder(
      order.mercadoPagoOrderId,
    );
    if (confirmacao.tipo === 'indeterminado') {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    const aposCancelamento = interpretarSituacaoFinanceira(confirmacao.order);
    if (aposCancelamento.tipo !== 'encerrada_sem_pagamento') {
      await this.liberarBloqueio(cobranca, posseAte);
      return;
    }

    await this.finalizarExpiracaoConfirmada(
      cobranca,
      posseAte,
      order.id as string,
      order.mercadoPagoOrderId,
      confirmacao.order.status ?? 'canceled',
      confirmacao.order.statusDetail ?? 'expired',
    );
  }

  private async finalizarExpiracaoConfirmada(
    cobranca: Cobranca,
    posseAte: Date | null,
    orderLocalId: string,
    mercadoPagoOrderId: string,
    statusOrder: string,
    statusDetail: string,
  ): Promise<void> {
    const expiradaEm = cobranca.prazoPagamento;
    const eventId = randomUUID();

    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(cobranca.id as string);
      if (!atual?.id || atual.situacao !== SituacaoCobranca.PENDENTE) return;

      const copia = this.clonar(atual);
      copia.marcarExpirada();
      if (!(await this.gravar(ctx, cobranca.id as string, copia, posseAte))) {
        return;
      }

      await this.orders.desativar(ctx, orderLocalId);
      await this.orders.atualizarSituacao(
        ctx,
        orderLocalId,
        statusOrder,
        statusDetail,
      );

      const envelope: EnvelopeMensagem<PayloadCobrancaExpirada> = {
        eventId,
        eventType: EVENTO_COBRANCA_EXPIRADA,
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: atual.correlationId,
        causationId: null,
        ordemServicoId: atual.ordemServicoId,
        rodada: atual.rodada,
        payload: {
          cobrancaId: atual.id,
          expiradaEm: expiradaEm.toISOString(),
          orderId: mercadoPagoOrderId,
          statusOrderMercadoPago: statusOrder,
          statusDetailMercadoPago: statusDetail,
        },
      };

      await this.outbox.registrar(ctx, {
        eventId,
        eventType: EVENTO_COBRANCA_EXPIRADA,
        envelope,
        correlationId: atual.correlationId,
        destino: DESTINO_FILA_OS,
      });
    });
  }

  private async marcarExpiradaSemOrder(
    cobranca: Cobranca,
    posseAte: Date | null,
  ): Promise<void> {
    const eventId = randomUUID();
    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(cobranca.id as string);
      if (!atual?.id || atual.situacao !== SituacaoCobranca.PENDENTE) return;
      const copia = this.clonar(atual);
      copia.marcarExpirada();
      if (!(await this.gravar(ctx, cobranca.id as string, copia, posseAte))) {
        return;
      }

      const envelope: EnvelopeMensagem<PayloadCobrancaExpirada> = {
        eventId,
        eventType: EVENTO_COBRANCA_EXPIRADA,
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: atual.correlationId,
        causationId: null,
        ordemServicoId: atual.ordemServicoId,
        rodada: atual.rodada,
        payload: {
          cobrancaId: atual.id,
          expiradaEm: atual.prazoPagamento.toISOString(),
          orderId: '',
          statusOrderMercadoPago: 'canceled',
          statusDetailMercadoPago: 'expired',
        },
      };

      await this.outbox.registrar(ctx, {
        eventId,
        eventType: EVENTO_COBRANCA_EXPIRADA,
        envelope,
        correlationId: atual.correlationId,
        destino: DESTINO_FILA_OS,
      });
    });
  }

  private async liberarBloqueio(
    cobranca: Cobranca,
    posseAte: Date | null,
  ): Promise<void> {
    await this.unitOfWork.executar(async (ctx) => {
      const copia = this.clonar(cobranca);
      copia.liberarBloqueioConciliacao();
      await this.gravar(ctx, cobranca.id as string, copia, posseAte);
    });
  }

  private posseAtiva(cobranca: Cobranca): Date | null {
    const ate = cobranca.bloqueadoConciliacaoAte;
    if (ate && ate.getTime() > Date.now()) return ate;
    return null;
  }

  private async gravar(
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
