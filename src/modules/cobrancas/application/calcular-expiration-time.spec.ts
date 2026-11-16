import {
  calcularExpirationTimeIso,
  centavosParaValorMercadoPago,
} from './calcular-expiration-time';

describe('calcularExpirationTimeIso', () => {
  it('respeita mínimo PT3M', () => {
    const agora = new Date('2026-11-15T21:00:00.000Z');
    const prazo = new Date('2026-11-15T21:01:00.000Z');
    expect(calcularExpirationTimeIso(prazo, agora)).toBe('PT3M');
  });

  it('calcula minutos até o prazo', () => {
    const agora = new Date('2026-11-15T21:00:00.000Z');
    const prazo = new Date('2026-11-15T21:15:00.000Z');
    expect(calcularExpirationTimeIso(prazo, agora)).toBe('PT15M');
  });
});

describe('centavosParaValorMercadoPago', () => {
  it('formata com duas casas decimais', () => {
    expect(centavosParaValorMercadoPago(15000)).toBe('150.00');
  });
});
