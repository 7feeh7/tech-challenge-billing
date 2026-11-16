import { randomUUID } from 'node:crypto';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_COBRANCA_CRIADA,
  EVENTO_PAGAMENTO_CONFIRMADO,
  type PayloadCobrancaCriada,
  type PayloadPagamentoConfirmado,
} from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { interpretarSituacaoFinanceira } from '../../domain/interpretar-situacao-order';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import {
  calcularExpirationTimeIso,
  centavosParaValorMercadoPago,
} from '../calcular-expiration-time';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '../ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import type { TentativaRecusaGateway } from '../ports/tentativa-recusa.gateway';

export class ConciliarCobrancaService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly tentativas: TentativaRecusaGateway,
    private readonly operacoes: OperacaoCriacaoOrderGateway,
    private readonly outbox: OutboxGateway,
    private readonly payerEmail: string,
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

    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(cobrancaId);
      if (!atual?.id) return;

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
        return;
      }

      if (interpretacao.tipo === 'paga') {
        const copia = this.clonar(atual);
        copia.confirmarPagamento(interpretacao.aprovadoEm);
        if (!(await this.gravarCobranca(ctx, cobrancaId, copia, posseAte))) {
          return;
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
        return;
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
        return;
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
          void this.tentarReemitirOrderForaTransacao(cobrancaId, atual);
        }
        return;
      }

      const pendente = this.clonar(atual);
      pendente.liberarBloqueioConciliacao();
      await this.gravarCobranca(ctx, cobrancaId, pendente, posseAte);
    });
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

  private async tentarReemitirOrderForaTransacao(
    cobrancaId: string,
    cobranca: Cobranca,
  ): Promise<void> {
    const chave = randomUUID();
    await this.unitOfWork.executar(async (ctx) => {
      await this.operacoes.reiniciarParaNovaOrder(ctx, cobrancaId, chave);
    });

    const resultado = await this.mercadoPago.criarOrder({
      externalReference: cobrancaId,
      totalAmount: centavosParaValorMercadoPago(cobranca.valorTotalCentavos),
      expirationTime: calcularExpirationTimeIso(cobranca.prazoPagamento),
      idempotencyKey: chave,
      payerEmail: this.payerEmail,
    });

    if (resultado.tipo !== 'sucesso') return;

    const eventId = randomUUID();
    await this.unitOfWork.executar(async (ctx) => {
      await this.orders.criar(ctx, {
        cobrancaId,
        mercadoPagoOrderId: resultado.orderId,
        chaveIdempotencia: chave,
        checkoutUrl: resultado.checkoutUrl,
        statusOrder: resultado.status ?? null,
        statusDetail: resultado.statusDetail ?? null,
        ativa: true,
      });

      const atual = await this.cobrancas.buscarPorId(cobrancaId);
      if (!atual?.id) return;
      const copia = this.clonar(atual);
      copia.marcarPendente(resultado.checkoutUrl);
      await this.cobrancas.atualizar(ctx, cobrancaId, copia);
      await this.operacoes.marcarConcluida(ctx, cobrancaId);

      const envelope: EnvelopeMensagem<PayloadCobrancaCriada> = {
        eventId,
        eventType: EVENTO_COBRANCA_CRIADA,
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: atual.correlationId,
        causationId: null,
        ordemServicoId: atual.ordemServicoId,
        rodada: atual.rodada,
        payload: {
          cobrancaId: atual.id,
          orderId: resultado.orderId,
          linkPagamento: resultado.checkoutUrl,
          prazoPagamento: atual.prazoPagamento.toISOString(),
          valorCentavos: atual.valorTotalCentavos,
        },
      };

      await this.outbox.registrar(ctx, {
        eventId,
        eventType: EVENTO_COBRANCA_CRIADA,
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
