import {
  interpretarSituacaoFinanceira,
  type OrderMercadoPagoConsultada,
} from './interpretar-situacao-order';

describe('interpretarSituacaoFinanceira', () => {
  it('confirma pagamento quando order processed e pagamento accredited', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'processed',
      statusDetail: 'accredited',
      pagamentos: [
        {
          id: 'PAY1',
          status: 'accredited',
          dateApproved: '2026-11-15T21:12:28.000Z',
        },
      ],
    };
    const resultado = interpretarSituacaoFinanceira(order);
    expect(resultado.tipo).toBe('paga');
    if (resultado.tipo === 'paga') {
      expect(resultado.paymentId).toBe('PAY1');
    }
  });

  it('registra recusa com order action_required e pagamento failed', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'action_required',
      statusDetail: 'waiting_retry',
      pagamentos: [
        {
          id: 'PAY1',
          status: 'failed',
          statusDetail: 'insufficient_amount',
        },
      ],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe('recusada');
  });

  it('não confirma pagamento quando webhook diz processed mas GET indica recusa', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'action_required',
      statusDetail: 'waiting_retry',
      pagamentos: [
        { id: 'PAY1', status: 'failed', statusDetail: 'cc_rejected' },
      ],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).not.toBe('paga');
  });

  it('mantém aguardando pagamento em order created', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'created',
      pagamentos: [],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe('aguardando_pagamento');
  });

  it('classifica situação não mapeada como indeterminada', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'refunded',
      pagamentos: [],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe('indeterminada');
  });

  it('identifica order encerrada sem pagamento', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'canceled',
      statusDetail: 'expired',
      pagamentos: [],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe(
      'encerrada_sem_pagamento',
    );
  });
});
