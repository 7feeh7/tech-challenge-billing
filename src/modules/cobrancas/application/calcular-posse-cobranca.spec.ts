import { ConfiguracaoReivindicacaoInvalidaError } from '@/shared/config/configuracao-reivindicacao-invalida.error';
import {
  CHAMADAS_MP_CONSULTA_FINANCEIRA_POR_EXECUCAO,
  calcularMinimoPosseAprovacaoMs,
  calcularMinimoPosseOutboxMs,
  calcularMinimoPosseCancelamentoFinanceiroMs,
  calcularPosseCancelamentoFinanceiroMs,
  calcularPosseCobrancaMs,
  calcularPosseProcessadorMs,
  calcularTempoOperacaoFinanceiraMesmaReivindicacaoMs,
  overridePosseInsuficiente,
} from './calcular-posse-cobranca';

describe('calcularPosseCobrancaMs', () => {
  it('usa override quando informado', () => {
    expect(
      calcularPosseCobrancaMs({
        loteConciliacao: 10,
        loteCriacao: 5,
        loteExpiracao: 10,
        mpRequestTimeoutMs: 30_000,
        overrideMs: 1_000_000,
      }),
    ).toBe(1_000_000);
  });

  it('inclui o lote de expiração no mínimo calculado', () => {
    const comExpiracaoLote15 = calcularPosseCobrancaMs({
      loteConciliacao: 10,
      loteCriacao: 5,
      loteExpiracao: 15,
      mpRequestTimeoutMs: 30_000,
    });
    expect(comExpiracaoLote15).toBeGreaterThan(950_000);
  });

  it('toma o pior entre conciliação (3 MP/item) e criação (1 MP/item)', () => {
    const posse = calcularPosseCobrancaMs({
      loteConciliacao: 10,
      loteCriacao: 5,
      loteExpiracao: 10,
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
      loteExpiracao: 10,
      mpRequestTimeoutMs: 30_000,
    });
    expect(overridePosseInsuficiente(35_000, minimo)).toBe(true);
    expect(overridePosseInsuficiente(minimo, minimo)).toBe(false);
  });

  it('rejeita override insuficiente quando validarOverride', () => {
    expect(() =>
      calcularPosseCobrancaMs({
        loteConciliacao: 10,
        loteCriacao: 5,
        loteExpiracao: 10,
        mpRequestTimeoutMs: 30_000,
        overrideMs: 35_000,
        validarOverride: true,
      }),
    ).toThrow(ConfiguracaoReivindicacaoInvalidaError);
  });
});

describe('mínimos de aprovação e outbox', () => {
  it('calcula aprovação com tentativas OS por item do lote', () => {
    expect(
      calcularMinimoPosseAprovacaoMs({
        lote: 10,
        osRequestMaxTentativas: 3,
        osRequestTimeoutMs: 3_000,
      }),
    ).toBe(10 * (3 * 3_000 + 5_000));
  });

  it('calcula outbox por envio SQS no lote', () => {
    expect(
      calcularMinimoPosseOutboxMs({ lote: 10, sqsRequestTimeoutMs: 30_000 }),
    ).toBe(10 * (30_000 + 5_000));
  });
});

describe('calcularPosseCancelamentoFinanceiroMs', () => {
  it('cobre consulta com efeito (pior caso de chamadas na mesma reivindicação)', () => {
    const porItem = calcularTempoOperacaoFinanceiraMesmaReivindicacaoMs({
      mpRequestTimeoutMs: 30_000,
      mpRetryBackoffMs: 30_000,
    });
    expect(porItem).toBe(
      CHAMADAS_MP_CONSULTA_FINANCEIRA_POR_EXECUCAO * 30_000 +
        30_000 +
        5_000,
    );
    const posse = calcularPosseCancelamentoFinanceiroMs({
      lote: 5,
      mpRequestTimeoutMs: 30_000,
      mpRetryBackoffMs: 30_000,
    });
    expect(posse).toBe(5 * porItem);
    expect(posse).toBe(775_000);
  });

  it('não multiplica MAX_TENTATIVAS_MP no lote (retentativas via adiar são ciclos posteriores)', () => {
    const comBackoff = calcularMinimoPosseCancelamentoFinanceiroMs({
      lote: 5,
      mpRequestTimeoutMs: 30_000,
      mpRetryBackoffMs: 30_000,
    });
    const semBackoff = calcularMinimoPosseCancelamentoFinanceiroMs({
      lote: 5,
      mpRequestTimeoutMs: 30_000,
    });
    expect(comBackoff).toBe(semBackoff + 5 * 30_000);
    expect(comBackoff).not.toBe(5 * 5 * 125_000);
  });

  it('rejeita override 625000 quando o mínimo com backoff é 775000', () => {
    const minimo = calcularMinimoPosseCancelamentoFinanceiroMs({
      lote: 5,
      mpRequestTimeoutMs: 30_000,
      mpRetryBackoffMs: 30_000,
    });
    expect(minimo).toBe(775_000);
    expect(() =>
      calcularPosseCancelamentoFinanceiroMs({
        lote: 5,
        mpRequestTimeoutMs: 30_000,
        mpRetryBackoffMs: 30_000,
        overrideMs: 625_000,
        validarOverride: true,
      }),
    ).toThrow(ConfiguracaoReivindicacaoInvalidaError);
  });
});
