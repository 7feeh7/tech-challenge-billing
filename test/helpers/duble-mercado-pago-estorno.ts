import type { MercadoPagoGateway } from '../../src/modules/cobrancas/application/ports/mercado-pago.gateway';

export type ModoEstornoSimulado =
  | 'integral'
  | 'parcial'
  | 'indeterminado'
  | 'recusado';

interface OrderSimulada {
  status:
    | 'processed'
    | 'refunded'
    | 'partially_refunded'
    | 'created'
    | 'canceled';
  aprovadoEm: string;
}

export interface ChamadaEstorno {
  orderId: string;
  chave: string;
}

export interface DubleMercadoPagoEstorno {
  gateway: MercadoPagoGateway;
  chamadasEstorno: ChamadaEstorno[];
  chamadasConsulta: string[];
  pagar(orderId: string, aprovadoEm?: string): void;
  encerrarSemPagamento(orderId: string): void;
  definirModoEstorno(modo: ModoEstornoSimulado): void;
  definirConsultaIndeterminada(indeterminada: boolean): void;
}

/**
 * Dublê do Mercado Pago com estado por order: o estorno só aparece na consulta
 * conforme o modo simulado. Cada chamada é registrada para provar a chave usada.
 */
export function criarDubleMercadoPagoEstorno(): DubleMercadoPagoEstorno {
  const orders = new Map<string, OrderSimulada>();
  const chamadasEstorno: ChamadaEstorno[] = [];
  const chamadasConsulta: string[] = [];
  let modo: ModoEstornoSimulado = 'integral';
  let consultaIndeterminada = false;

  const gateway: MercadoPagoGateway = {
    criarOrder: jest.fn(),
    cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
    consultarOrder: async (orderId) => {
      chamadasConsulta.push(orderId);
      if (consultaIndeterminada) {
        return { tipo: 'indeterminado', motivo: 'timeout' };
      }
      const order = orders.get(orderId);
      if (!order) return { tipo: 'indeterminado', motivo: 'order_inexistente' };
      return {
        tipo: 'sucesso',
        order: {
          id: orderId,
          status: order.status,
          refundedAmount:
            order.status === 'partially_refunded' ? 400 : undefined,
          pagamentos:
            order.status === 'canceled'
              ? []
              : [
                  {
                    id: `PAY-${orderId}`,
                    status:
                      order.status === 'processed' ? 'accredited' : 'refunded',
                    dateApproved: order.aprovadoEm,
                  },
                ],
        },
      };
    },
    estornarTotal: async (orderId, chave) => {
      chamadasEstorno.push({ orderId, chave });
      const order = orders.get(orderId);
      if (!order) return { tipo: 'indeterminado', motivo: 'order_inexistente' };
      if (modo === 'indeterminado') {
        return { tipo: 'indeterminado', motivo: 'timeout' };
      }
      if (modo === 'recusado') {
        return { tipo: 'conflito_especifico', codigo: 'refund_rejected' };
      }
      if (modo === 'parcial') {
        order.status = 'partially_refunded';
        return { tipo: 'sucesso' };
      }
      order.status = 'refunded';
      return { tipo: 'sucesso' };
    },
  };

  return {
    gateway,
    chamadasEstorno,
    chamadasConsulta,
    pagar: (orderId, aprovadoEm = '2026-11-15T12:00:00.000Z') => {
      orders.set(orderId, {
        status: 'processed',
        aprovadoEm,
      });
    },
    encerrarSemPagamento: (orderId) => {
      orders.set(orderId, {
        status: 'canceled',
        aprovadoEm: '2026-11-15T12:00:00.000Z',
      });
    },
    definirModoEstorno: (novoModo) => {
      modo = novoModo;
    },
    definirConsultaIndeterminada: (indeterminada) => {
      consultaIndeterminada = indeterminada;
    },
  };
}
