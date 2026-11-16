import { interpretarEstornoOrder } from './interpretar-estorno-order';

describe('interpretarEstornoOrder', () => {
  it('identifica estorno integral', () => {
    const r = interpretarEstornoOrder({
      id: 'ORD1',
      status: 'refunded',
      pagamentos: [],
    });
    expect(r.tipo).toBe('estorno_integral');
  });

  it('identifica estorno parcial', () => {
    const r = interpretarEstornoOrder({
      id: 'ORD1',
      status: 'partially_refunded',
      pagamentos: [],
      refundedAmount: 5_000,
    });
    expect(r.tipo).toBe('estorno_parcial');
  });

  it('status desconhecido fica indeterminado', () => {
    const r = interpretarEstornoOrder({
      id: 'ORD1',
      status: 'processed',
      pagamentos: [],
    });
    expect(r.tipo).toBe('indeterminada');
  });

  it('order expired sem estorno', () => {
    const r = interpretarEstornoOrder({
      id: 'ORD1',
      status: 'expired',
      pagamentos: [],
    });
    expect(r.tipo).toBe('sem_estorno');
  });

  it('order cancelada sem estorno', () => {
    const r = interpretarEstornoOrder({
      id: 'ORD1',
      status: 'canceled',
      pagamentos: [],
    });
    expect(r.tipo).toBe('sem_estorno');
  });
});
