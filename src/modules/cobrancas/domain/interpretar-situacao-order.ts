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
  createdDate?: string;
  pagamentos: PagamentoNaOrder[];
}

// A Orders API devolve o pagamento aprovado como processed/accredited
// (comprovado no GET real do sandbox na E05).
function ehPagamentoAprovado(pagamento: PagamentoNaOrder): boolean {
  if (pagamento.status === 'approved' || pagamento.status === 'accredited') {
    return true;
  }
  return (
    pagamento.status === 'processed' && pagamento.statusDetail === 'accredited'
  );
}

// O pagamento da Orders API não traz data de aprovação; só a order traz
// created_date e last_updated_date. Sem date_approved, usa-se created_date:
// last_updated_date é posterior à aprovação quando a order é atualizada depois
// (estorno, por exemplo) e transformaria pagamento em dia em pagamento tardio.
// created_date nunca é posterior à aprovação, e a order expira junto com o
// prazo de pagamento, então order processed foi paga dentro do prazo.
function obterDataAprovacao(
  order: OrderMercadoPagoConsultada,
  pagamento: PagamentoNaOrder,
): Date {
  const dataAprovacao = pagamento.dateApproved ?? order.createdDate;
  return dataAprovacao ? new Date(dataAprovacao) : new Date();
}

export function interpretarSituacaoFinanceira(
  order: OrderMercadoPagoConsultada,
): SituacaoFinanceiraInterpretada {
  const pagamentoAprovado = order.pagamentos.find(ehPagamentoAprovado);
  if (
    pagamentoAprovado &&
    (order.status === 'processed' || pagamentoAprovado.status === 'accredited')
  ) {
    return {
      tipo: 'paga',
      aprovadoEm: obterDataAprovacao(order, pagamentoAprovado),
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
