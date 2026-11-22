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
    expect(interpretarSituacaoFinanceira(order).tipo).toBe(
      'aguardando_pagamento',
    );
  });

  it('classifica situação não mapeada como indeterminada', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'refunded',
      pagamentos: [],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe('indeterminada');
  });

  it('considera paga com status approved sem dateApproved', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'processed',
      pagamentos: [{ id: 'PAY1', status: 'approved' }],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe('paga');
  });

  it('registra recusa com order processed e pagamento failed', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'processed',
      pagamentos: [
        { id: 'PAY1', status: 'failed', statusDetail: 'cc_rejected' },
      ],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe('recusada');
  });

  it('encerra order com status expired', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      status: 'expired',
      pagamentos: [],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe(
      'encerrada_sem_pagamento',
    );
  });

  it('aguarda pagamento quando status ausente', () => {
    const order: OrderMercadoPagoConsultada = {
      id: 'ORD1',
      pagamentos: [],
    };
    expect(interpretarSituacaoFinanceira(order).tipo).toBe(
      'aguardando_pagamento',
    );
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

  describe('order processed da Orders API (formato real, sem date_approved)', () => {
    const orderReal = (
      pagamentos: OrderMercadoPagoConsultada['pagamentos'],
    ): OrderMercadoPagoConsultada => ({
      id: 'ORDTST01M7GMMTFB6C17A37RM207XAST',
      status: 'processed',
      statusDetail: 'accredited',
      createdDate: '2026-11-15T22:18:32.827Z',
      pagamentos,
    });
    const pagamentoRecusadoReal = {
      id: 'PAY01M7GN4JNQ27FGP9YTXRP9TCG6',
      status: 'failed',
      statusDetail: 'insufficient_amount',
    };
    const pagamentoProcessadoReal = {
      id: 'PAY01M7GN7HTVMPN47J1BW52QB7B7',
      status: 'processed',
      statusDetail: 'accredited',
    };

    it('confirma pagamento processed/accredited e ignora a tentativa recusada anterior', () => {
      const resultado = interpretarSituacaoFinanceira(
        orderReal([pagamentoRecusadoReal, pagamentoProcessadoReal]),
      );
      expect(resultado).toEqual({
        tipo: 'paga',
        aprovadoEm: new Date('2026-11-15T22:18:32.827Z'),
        paymentId: 'PAY01M7GN7HTVMPN47J1BW52QB7B7',
      });
    });

    it('prefere date_approved do pagamento quando existir', () => {
      const resultado = interpretarSituacaoFinanceira(
        orderReal([
          {
            ...pagamentoProcessadoReal,
            dateApproved: '2026-11-15T22:20:00.000Z',
          },
        ]),
      );
      expect(resultado).toMatchObject({
        tipo: 'paga',
        aprovadoEm: new Date('2026-11-15T22:20:00.000Z'),
      });
    });

    it('recorre ao relógio quando não há nenhuma data na order', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
      try {
        const resultado = interpretarSituacaoFinanceira({
          ...orderReal([pagamentoProcessadoReal]),
          createdDate: undefined,
        });
        expect(resultado).toMatchObject({
          tipo: 'paga',
          aprovadoEm: new Date('2026-11-16T10:00:00.000Z'),
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('não confirma pagamento processed com status_detail diferente de accredited', () => {
      const resultado = interpretarSituacaoFinanceira(
        orderReal([
          { id: 'PAY1', status: 'processed', statusDetail: 'in_process' },
        ]),
      );
      expect(resultado.tipo).not.toBe('paga');
    });

    it('não confirma pagamento processed sem status_detail', () => {
      const resultado = interpretarSituacaoFinanceira(
        orderReal([{ id: 'PAY1', status: 'processed' }]),
      );
      expect(resultado.tipo).not.toBe('paga');
    });

    it('mantém recusa quando order processed só tem pagamento failed', () => {
      const resultado = interpretarSituacaoFinanceira(
        orderReal([pagamentoRecusadoReal]),
      );
      expect(resultado).toEqual({
        tipo: 'recusada',
        paymentId: 'PAY01M7GN4JNQ27FGP9YTXRP9TCG6',
        motivo: 'insufficient_amount',
      });
    });
  });
});
