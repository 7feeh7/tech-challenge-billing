import {
  calcularPrazoPagamento,
  montarChaveReserva,
} from './calcular-prazo-pagamento';

describe('calcularPrazoPagamento', () => {
  it('subtrai a carência do prazo de referência', () => {
    const referencia = new Date('2026-11-15T12:00:00.000Z');
    const prazo = calcularPrazoPagamento(referencia, 2);
    expect(prazo.toISOString()).toBe('2026-11-15T11:58:00.000Z');
  });

  it('rejeita carência inválida', () => {
    expect(() => calcularPrazoPagamento(new Date(), Number.NaN)).toThrow(
      'Carência inválida',
    );
  });

  it('monta chave determinística da reserva', () => {
    expect(montarChaveReserva('orc-1', 3)).toBe('reserva:orc-1:3');
  });
});
