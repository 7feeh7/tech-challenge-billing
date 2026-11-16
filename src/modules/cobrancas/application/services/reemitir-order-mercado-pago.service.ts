import { randomUUID } from 'node:crypto';
import type { BloqueioCriacaoCobrancaGateway } from '@/modules/cancelamento-financeiro/application/ports/bloqueio-criacao-cobranca.gateway';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_COBRANCA_CRIADA,
  type PayloadCobrancaCriada,
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

export class ReemitirOrderMercadoPagoService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly operacoes: OperacaoCriacaoOrderGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly outbox: OutboxGateway,
    private readonly bloqueios: BloqueioCriacaoCobrancaGateway,
    private readonly payerEmail: string,
  ) {}

  async executar(cobrancaId: string, posseAte: Date | null): Promise<void> {
    const cobrancaBase = await this.cobrancas.buscarPorId(cobrancaId);
    if (!cobrancaBase?.id) return;
    if (cobrancaBase.situacao !== SituacaoCobranca.PENDENTE) return;
    if (!cobrancaBase.aindaNoPrazo()) return;

    if (
      await this.bloqueios.existe(
        cobrancaBase.ordemServicoId,
        cobrancaBase.rodada,
      )
    ) {
      return;
    }

    const orderAtiva = await this.orders.buscarAtivaPorCobrancaId(cobrancaId);
    if (orderAtiva) return;

    const chave = await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(cobrancaId);
      if (!atual?.id) return null;
      if (atual.situacao !== SituacaoCobranca.PENDENTE) return null;
      if (!atual.aindaNoPrazo()) return null;

      const aindaAtiva = await this.orders.buscarAtivaPorCobrancaId(cobrancaId);
      if (aindaAtiva) return null;

      return this.operacoes.garantirReemissaoEmAndamento(ctx, cobrancaId);
    });

    if (!chave) return;

    const ultimaOrder = await this.orders.buscarUltimaPorCobrancaId(cobrancaId);
    if (ultimaOrder?.mercadoPagoOrderId) {
      const consulta = await this.mercadoPago.consultarOrder(
        ultimaOrder.mercadoPagoOrderId,
      );
      if (consulta.tipo === 'indeterminado') return;
      const interpretacao = interpretarSituacaoFinanceira(consulta.order);
      if (interpretacao.tipo !== 'encerrada_sem_pagamento') return;
    }

    const cobranca = await this.cobrancas.buscarPorId(cobrancaId);
    if (!cobranca?.id || !cobranca.aindaNoPrazo()) return;

    const resultado = await this.mercadoPago.criarOrder({
      externalReference: cobranca.id,
      totalAmount: centavosParaValorMercadoPago(cobranca.valorTotalCentavos),
      expirationTime: calcularExpirationTimeIso(cobranca.prazoPagamento),
      idempotencyKey: chave,
      payerEmail: this.payerEmail,
    });

    if (resultado.tipo !== 'sucesso') return;

    const eventId = randomUUID();

    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(cobrancaId);
      if (!atual?.id) return;
      if (atual.situacao !== SituacaoCobranca.PENDENTE) return;

      const ativa = await this.orders.buscarAtivaPorCobrancaId(cobrancaId);
      if (ativa) return;

      await this.orders.criar(ctx, {
        cobrancaId,
        mercadoPagoOrderId: resultado.orderId,
        chaveIdempotencia: chave,
        checkoutUrl: resultado.checkoutUrl,
        statusOrder: resultado.status ?? null,
        statusDetail: resultado.statusDetail ?? null,
        ativa: true,
      });

      const copia = this.clonar(atual);
      copia.marcarPendente(resultado.checkoutUrl);
      if (!(await this.gravarCobranca(ctx, cobrancaId, copia, posseAte))) {
        return;
      }
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
