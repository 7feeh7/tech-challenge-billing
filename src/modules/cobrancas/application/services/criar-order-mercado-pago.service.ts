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
  type PayloadCobrancaCriada,
} from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import {
  calcularExpirationTimeIso,
  centavosParaValorMercadoPago,
} from '../calcular-expiration-time';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '../ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';

export class CriarOrderMercadoPagoService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly operacoes: OperacaoCriacaoOrderGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly outbox: OutboxGateway,
    private readonly payerEmail: string,
  ) {}

  async executar(cobrancaId: string): Promise<void> {
    const cobrancaBase = await this.cobrancas.buscarPorId(cobrancaId);
    if (!cobrancaBase?.id) return;
    if (cobrancaBase.situacao !== SituacaoCobranca.INTENCAO) {
      return;
    }

    const posseAte = this.posseReivindicacaoAtiva(cobrancaBase);

    const orderAtiva = await this.orders.buscarAtivaPorCobrancaId(cobrancaId);
    if (orderAtiva) {
      await this.unitOfWork.executar(async (ctx) => {
        const copia = this.clonar(cobrancaBase);
        copia.marcarPendente(orderAtiva.checkoutUrl);
        copia.liberarBloqueioConciliacao();
        await this.gravarCobranca(ctx, cobrancaId, copia, posseAte);
      });
      return;
    }

    const chave = await this.unitOfWork.executar(async (ctx) => {
      const existente = await this.operacoes.obterPorCobrancaId(cobrancaId);
      if (existente?.situacao === 'CONCLUIDA') {
        return null;
      }
      const chaveIdempotencia = existente?.chaveIdempotencia ?? randomUUID();
      await this.operacoes.garantirEmAndamento(
        ctx,
        cobrancaId,
        chaveIdempotencia,
      );
      return chaveIdempotencia;
    });

    if (!chave) {
      await this.liberarBloqueio(cobrancaId, cobrancaBase, posseAte);
      return;
    }

    const resultado = await this.mercadoPago.criarOrder({
      externalReference: cobrancaBase.id,
      totalAmount: centavosParaValorMercadoPago(
        cobrancaBase.valorTotalCentavos,
      ),
      expirationTime: calcularExpirationTimeIso(cobrancaBase.prazoPagamento),
      idempotencyKey: chave,
      payerEmail: this.payerEmail,
    });

    if (resultado.tipo === 'indeterminado') {
      await this.liberarBloqueio(cobrancaId, cobrancaBase, posseAte);
      return;
    }

    const eventId = randomUUID();

    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(cobrancaId);
      if (!atual?.id) return;

      const orderExistente =
        await this.orders.buscarAtivaPorCobrancaId(cobrancaId);
      if (
        orderExistente &&
        orderExistente.mercadoPagoOrderId === resultado.orderId
      ) {
        const copia = this.clonar(atual);
        copia.marcarPendente(resultado.checkoutUrl);
        copia.liberarBloqueioConciliacao();
        if (!(await this.gravarCobranca(ctx, cobrancaId, copia, posseAte))) {
          return;
        }
        await this.operacoes.marcarConcluida(ctx, cobrancaId);
        return;
      }

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

  private async liberarBloqueio(
    cobrancaId: string,
    cobranca: Cobranca,
    posseAte: Date | null,
  ): Promise<void> {
    await this.unitOfWork.executar(async (ctx) => {
      const copia = this.clonar(cobranca);
      copia.liberarBloqueioConciliacao();
      await this.gravarCobranca(ctx, cobrancaId, copia, posseAte);
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
