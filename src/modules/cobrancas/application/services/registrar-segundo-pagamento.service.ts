import { randomUUID } from 'node:crypto';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_PAGAMENTO_CONFIRMADO,
  type PayloadPagamentoConfirmado,
} from '@/shared/messaging/envelope';
import type { Cobranca } from '../../domain/entities/cobranca.entity';
import type { EstornoAutomaticoGateway } from '../ports/estorno-automatico.gateway';
import type {
  OrderMercadoPagoGateway,
  OrderMercadoPagoRegistro,
} from '../ports/order-mercado-pago.gateway';
import type { ExecutarEstornoAutomaticoService } from './executar-estorno-automatico.service';

/**
 * Segundo pagamento: order da mesma cobrança, diferente da que confirmou o
 * pagamento, aprovada no Mercado Pago. Nunca estorna a order legítima.
 */
export class RegistrarSegundoPagamentoService {
  constructor(
    private readonly estornos: EstornoAutomaticoGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly outbox: OutboxGateway,
    private readonly executarEstorno: ExecutarEstornoAutomaticoService,
  ) {}

  async orderEhSegundoPagamento(
    cobranca: Cobranca,
    order: OrderMercadoPagoRegistro,
  ): Promise<boolean> {
    if (!cobranca.id || !cobranca.pagamentoConfirmado()) return false;
    const confirmadora = await this.orders.buscarQueConfirmouPagamento(
      cobranca.id,
    );
    return confirmadora?.id !== order.id;
  }

  /**
   * Registra o segundo pagamento e publica `PagamentoConfirmado` da segunda
   * order na transação de quem chama. Devolve o estorno a executar depois do
   * commit, ou `null` quando não há o que fazer.
   */
  async registrar(
    ctx: ContextoTransacao,
    params: {
      cobranca: Cobranca;
      order: OrderMercadoPagoRegistro;
      aprovadoEm: Date;
    },
  ): Promise<string | null> {
    const { cobranca, order, aprovadoEm } = params;
    if (!cobranca.id || !order.id) return null;

    const { estorno, criado } = await this.estornos.registrarSeNovo(ctx, {
      cobrancaId: cobranca.id,
      orderMercadoPagoId: order.id,
      tipo: 'SEGUNDO_PAGAMENTO',
      valorCentavos: cobranca.valorTotalCentavos,
      aprovadoEm,
    });

    // Webhook repetido ou conciliação concorrente: o registro e a publicação
    // já existem, só resta retomar o estorno se ele ainda estiver aberto.
    if (!criado) {
      return estorno.situacao === 'EM_ANDAMENTO' ? estorno.id : null;
    }

    await this.orders.desativar(ctx, order.id);
    await this.publicarPagamentoConfirmado(ctx, cobranca, order, aprovadoEm);
    return estorno.id;
  }

  async iniciarEstorno(estornoId: string): Promise<void> {
    await this.executarEstorno.executar(estornoId);
  }

  private async publicarPagamentoConfirmado(
    ctx: ContextoTransacao,
    cobranca: Cobranca,
    order: OrderMercadoPagoRegistro,
    aprovadoEm: Date,
  ): Promise<void> {
    const eventId = randomUUID();
    const envelope: EnvelopeMensagem<PayloadPagamentoConfirmado> = {
      eventId,
      eventType: EVENTO_PAGAMENTO_CONFIRMADO,
      version: 1,
      occurredAt: new Date().toISOString(),
      source: 'billing',
      correlationId: cobranca.correlationId,
      causationId: null,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      payload: {
        cobrancaId: cobranca.id as string,
        orderId: order.mercadoPagoOrderId,
        aprovadoEm: aprovadoEm.toISOString(),
        valorCentavos: cobranca.valorTotalCentavos,
      },
    };
    await this.outbox.registrar(ctx, {
      eventId,
      eventType: EVENTO_PAGAMENTO_CONFIRMADO,
      envelope,
      correlationId: cobranca.correlationId,
      destino: DESTINO_FILA_OS,
    });
  }
}
