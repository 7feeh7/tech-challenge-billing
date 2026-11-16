import { randomUUID } from 'node:crypto';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_PAGAMENTO_TARDIO_REGISTRADO,
  type PayloadPagamentoTardioRegistrado,
} from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { interpretarEstornoOrder } from '../../domain/interpretar-estorno-order';
import type { OrderMercadoPagoConsultada } from '../../domain/interpretar-situacao-order';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';

export class TratarPagamentoTardioService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly outbox: OutboxGateway,
  ) {}

  async tratar(params: {
    cobrancaId: string;
    posseAte: Date | null;
    orderId: string;
    mercadoPagoOrderId: string;
    aprovadoEm: Date;
    orderConsultada: OrderMercadoPagoConsultada;
    chaveEstorno?: string;
  }): Promise<void> {
    const cobranca = await this.cobrancas.buscarPorId(params.cobrancaId);
    if (!cobranca?.id) return;

    const estornoExistente = interpretarEstornoOrder(params.orderConsultada);
    if (estornoExistente.tipo === 'estorno_integral') {
      await this.publicarSeNecessario(cobranca, params);
      return;
    }

    const order = await this.orders.buscarAtivaPorCobrancaId(params.cobrancaId);
    const chave =
      params.chaveEstorno ?? order?.chaveIdempotencia ?? randomUUID();

    const resposta = await this.mercadoPago.estornarTotal(
      params.mercadoPagoOrderId,
      chave,
    );
    if (resposta.tipo === 'indeterminado') {
      await this.liberarBloqueio(cobranca, params.posseAte);
      return;
    }

    const consulta = await this.mercadoPago.consultarOrder(
      params.mercadoPagoOrderId,
    );
    if (consulta.tipo === 'indeterminado') {
      await this.liberarBloqueio(cobranca, params.posseAte);
      return;
    }

    const estorno = interpretarEstornoOrder(consulta.order);
    if (
      estorno.tipo !== 'estorno_integral' &&
      estorno.tipo !== 'estorno_parcial'
    ) {
      await this.liberarBloqueio(cobranca, params.posseAte);
      return;
    }

    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(params.cobrancaId);
      if (!atual?.id) return;

      const copia = this.clonar(atual);
      if (copia.situacao === SituacaoCobranca.PENDENTE) {
        copia.marcarExpirada();
      }
      await this.gravar(ctx, params.cobrancaId, copia, params.posseAte);
      if (params.orderId) {
        await this.orders.desativar(ctx, params.orderId);
      }
    });

    await this.publicarSeNecessario(cobranca, params);
  }

  private async publicarSeNecessario(
    cobranca: Cobranca,
    params: {
      cobrancaId: string;
      mercadoPagoOrderId: string;
      aprovadoEm: Date;
      posseAte: Date | null;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    await this.unitOfWork.executar(async (ctx) => {
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
          orderId: params.mercadoPagoOrderId,
          aprovadoEm: params.aprovadoEm.toISOString(),
          tratamento: 'ESTORNO_AUTOMATICO',
        },
      };

      await this.outbox.registrar(ctx, {
        eventId,
        eventType: EVENTO_PAGAMENTO_TARDIO_REGISTRADO,
        envelope,
        correlationId: cobranca.correlationId,
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

  deveTratarPagamentoTardio(cobranca: Cobranca, aprovadoEm: Date): boolean {
    if (
      cobranca.situacao === SituacaoCobranca.EXPIRADA ||
      cobranca.situacao === SituacaoCobranca.CANCELADA
    ) {
      return true;
    }
    return (
      cobranca.situacao === SituacaoCobranca.PENDENTE &&
      aprovadoEm.getTime() > cobranca.prazoPagamento.getTime()
    );
  }
}
