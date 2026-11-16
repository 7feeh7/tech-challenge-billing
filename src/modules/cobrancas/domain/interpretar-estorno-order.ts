import type { OrderMercadoPagoConsultada } from './interpretar-situacao-order';

export type SituacaoEstornoInterpretada =
  | { tipo: 'estorno_integral' }
  | { tipo: 'estorno_parcial'; valorEstornadoCentavos: number }
  | { tipo: 'sem_estorno' }
  | { tipo: 'indeterminada'; motivo: string };

export function interpretarEstornoOrder(
  order: OrderMercadoPagoConsultada,
): SituacaoEstornoInterpretada {
  if (order.status === 'refunded') {
    return { tipo: 'estorno_integral' };
  }

  if (order.status === 'partially_refunded') {
    const valor = order.refundedAmount ?? 0;
    return { tipo: 'estorno_parcial', valorEstornadoCentavos: valor };
  }

  if (
    order.status === 'canceled' ||
    order.status === 'expired' ||
    order.statusDetail === 'expired'
  ) {
    return { tipo: 'sem_estorno' };
  }

  return {
    tipo: 'indeterminada',
    motivo: `status_order=${order.status ?? '?'}`,
  };
}
