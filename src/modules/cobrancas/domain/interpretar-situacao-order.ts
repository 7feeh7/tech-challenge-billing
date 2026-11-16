export type SituacaoFinanceiraInterpretada =
  | { tipo: 'paga'; aprovadoEm: Date; paymentId: string }
  | { tipo: 'recusada'; paymentId: string; motivo: string }
  | { tipo: 'aguardando_pagamento' }
  | { tipo: 'encerrada_sem_pagamento' }
  | { tipo: 'indeterminada'; motivo: string };

export interface PagamentoNaOrder {
  id: string;
  status: string;
  statusDetail?: string;
  dateApproved?: string;
}

export interface OrderMercadoPagoConsultada {
  id: string;
  status?: string;
  statusDetail?: string;
  refundedAmount?: number;
  pagamentos: PagamentoNaOrder[];
}

export function interpretarSituacaoFinanceira(
  order: OrderMercadoPagoConsultada,
): SituacaoFinanceiraInterpretada {
  const pagamentoAprovado = order.pagamentos.find(
    (p) => p.status === 'approved' || p.status === 'accredited',
  );
  if (
    pagamentoAprovado &&
    (order.status === 'processed' || pagamentoAprovado.status === 'accredited')
  ) {
    const aprovadoEm = pagamentoAprovado.dateApproved
      ? new Date(pagamentoAprovado.dateApproved)
      : new Date();
    return {
      tipo: 'paga',
      aprovadoEm,
      paymentId: pagamentoAprovado.id,
    };
  }

  const pagamentoRecusado = order.pagamentos.find((p) => p.status === 'failed');
  if (
    pagamentoRecusado &&
    (order.status === 'action_required' ||
      order.statusDetail === 'waiting_retry' ||
      order.status === 'processed')
  ) {
    return {
      tipo: 'recusada',
      paymentId: pagamentoRecusado.id,
      motivo: pagamentoRecusado.statusDetail ?? 'failed',
    };
  }

  if (
    order.status === 'canceled' ||
    order.statusDetail === 'expired' ||
    order.status === 'expired'
  ) {
    return { tipo: 'encerrada_sem_pagamento' };
  }

  if (
    order.status === 'created' ||
    order.status === 'action_required' ||
    !order.status
  ) {
    return { tipo: 'aguardando_pagamento' };
  }

  return {
    tipo: 'indeterminada',
    motivo: `status_order=${order.status ?? '?'}`,
  };
}
