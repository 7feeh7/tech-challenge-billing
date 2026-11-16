import {
  calcularPosseCancelamentoFinanceiroMs,
  calcularPosseCobrancaMs,
  calcularPosseProcessadorMs,
  overridePosseInsuficiente,
} from './calcular-posse-cobranca';

describe('calcularPosseCobrancaMs', () => {
  it('usa override quando informado', () => {
    expect(
      calcularPosseCobrancaMs({
        loteConciliacao: 10,
        loteCriacao: 5,
        mpRequestTimeoutMs: 30_000,
        overrideMs: 120_000,
      }),
    ).toBe(120_000);
  });

  it('toma o pior entre conciliação (3 MP/item) e criação (1 MP/item)', () => {
    const posse = calcularPosseCobrancaMs({
      loteConciliacao: 10,
      loteCriacao: 5,
      mpRequestTimeoutMs: 30_000,
    });
    const conciliacao = calcularPosseProcessadorMs({
      lote: 10,
      chamadasMercadoPagoPorItem: 3,
      mpRequestTimeoutMs: 30_000,
    });
    const criacao = calcularPosseProcessadorMs({
      lote: 5,
      chamadasMercadoPagoPorItem: 1,
      mpRequestTimeoutMs: 30_000,
    });
    expect(posse).toBe(Math.max(conciliacao, criacao));
  });

  it('detecta override insuficiente frente ao mínimo calculado', () => {
    const minimo = calcularPosseCobrancaMs({
      loteConciliacao: 10,
      loteCriacao: 5,
      mpRequestTimeoutMs: 30_000,
    });
    expect(overridePosseInsuficiente(35_000, minimo)).toBe(true);
    expect(overridePosseInsuficiente(minimo, minimo)).toBe(false);
  });
});

describe('calcularPosseCancelamentoFinanceiroMs', () => {
  it('considera 4 chamadas MP por item do lote', () => {
    const posse = calcularPosseCancelamentoFinanceiroMs({
      lote: 5,
      mpRequestTimeoutMs: 30_000,
    });
    expect(posse).toBe(5 * (4 * 30_000 + 5_000));
  });
});
