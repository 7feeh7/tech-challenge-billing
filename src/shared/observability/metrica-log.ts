export const METRICA_LOG = {
  SITUACAO_FINANCEIRA_INDETERMINADA:
    'billing.situacao_financeira_indeterminada',
  PENDENCIA_ESTORNO_ABERTA: 'billing.pendencia_estorno_aberta',
  OPERACAO_FINANCEIRA_INDETERMINADA:
    'billing.operacao_financeira_indeterminada',
} as const;

export type MetricaLog = (typeof METRICA_LOG)[keyof typeof METRICA_LOG];

export interface ContextoMetricaLog {
  ordemServicoId: string;
  rodada: number;
  correlationId: string;
  operacaoId?: string | null;
  cobrancaId?: string | null;
  motivo?: string | null;
}

// Os campos são listados um a um para que apenas contexto técnico, sem dados
// pessoais ou financeiros sensíveis, chegue ao log que gera a métrica no Datadog.
export function serializarMetricaLog(
  metrica: MetricaLog,
  contexto: ContextoMetricaLog,
): string {
  return JSON.stringify({
    metric: metrica,
    ordemServicoId: contexto.ordemServicoId,
    rodada: contexto.rodada,
    correlationId: contexto.correlationId,
    operacaoId: contexto.operacaoId,
    cobrancaId: contexto.cobrancaId,
    motivo: contexto.motivo,
  });
}
