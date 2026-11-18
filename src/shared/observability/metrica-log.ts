export const METRICA_LOG = {
  SITUACAO_FINANCEIRA_INDETERMINADA:
    'billing.situacao_financeira_indeterminada',
  PENDENCIA_ESTORNO_ABERTA: 'billing.pendencia_estorno_aberta',
  OPERACAO_FINANCEIRA_INDETERMINADA:
    'billing.operacao_financeira_indeterminada',
  MERCADO_PAGO_FALHA_TECNICA: 'billing.mercado_pago.falha_tecnica',
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

export type OperacaoMercadoPago =
  | 'criar_order'
  | 'consultar_order'
  | 'cancelar_order'
  | 'estornar_total';

export type MotivoFalhaTecnicaMercadoPago =
  | 'timeout'
  | 'rede'
  | 'http_5xx'
  | 'resposta_invalida'
  | 'token_ausente';

export interface ContextoFalhaTecnicaMercadoPago {
  operacao: OperacaoMercadoPago;
  motivo: MotivoFalhaTecnicaMercadoPago;
  statusHttp?: number;
}

// Sem identificadores da chamada: a métrica agrupa por operação e motivo, e
// corpo de resposta, mensagem de erro e URL poderiam expor dados sensíveis.
export function serializarFalhaTecnicaMercadoPago(
  contexto: ContextoFalhaTecnicaMercadoPago,
): string {
  return JSON.stringify({
    metric: METRICA_LOG.MERCADO_PAGO_FALHA_TECNICA,
    operacao: contexto.operacao,
    motivo: contexto.motivo,
    statusHttp: contexto.statusHttp,
  });
}
