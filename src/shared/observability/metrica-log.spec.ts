import { METRICA_LOG, serializarMetricaLog } from './metrica-log';

describe('serializarMetricaLog', () => {
  it('mantém estáveis os nomes das métricas de log', () => {
    expect(METRICA_LOG).toEqual({
      SITUACAO_FINANCEIRA_INDETERMINADA:
        'billing.situacao_financeira_indeterminada',
      PENDENCIA_ESTORNO_ABERTA: 'billing.pendencia_estorno_aberta',
      OPERACAO_FINANCEIRA_INDETERMINADA:
        'billing.operacao_financeira_indeterminada',
    });
  });

  it('serializa a métrica e o contexto técnico em JSON', () => {
    const json = serializarMetricaLog(METRICA_LOG.PENDENCIA_ESTORNO_ABERTA, {
      ordemServicoId: 'os1',
      rodada: 2,
      correlationId: 'corr',
      operacaoId: 'op1',
      cobrancaId: 'c1',
      motivo: 'reparo_iniciado',
    });

    expect(JSON.parse(json)).toEqual({
      metric: 'billing.pendencia_estorno_aberta',
      ordemServicoId: 'os1',
      rodada: 2,
      correlationId: 'corr',
      operacaoId: 'op1',
      cobrancaId: 'c1',
      motivo: 'reparo_iniciado',
    });
  });

  it('omite campos opcionais ausentes', () => {
    const json = serializarMetricaLog(
      METRICA_LOG.OPERACAO_FINANCEIRA_INDETERMINADA,
      { ordemServicoId: 'os1', rodada: 1, correlationId: 'corr' },
    );

    expect(JSON.parse(json)).toEqual({
      metric: 'billing.operacao_financeira_indeterminada',
      ordemServicoId: 'os1',
      rodada: 1,
      correlationId: 'corr',
    });
  });

  it('ignora campos fora do contexto técnico, como dados pessoais', () => {
    const contextoComExtras = {
      ordemServicoId: 'os1',
      rodada: 1,
      correlationId: 'corr',
      cpf: '12345678901',
      accessToken: 'segredo',
    };

    const json = serializarMetricaLog(
      METRICA_LOG.PENDENCIA_ESTORNO_ABERTA,
      contextoComExtras,
    );

    expect(json).not.toContain('12345678901');
    expect(json).not.toContain('segredo');
  });
});
