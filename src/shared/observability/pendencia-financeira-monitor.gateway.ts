export interface RegistrarPendenciaFinanceiraMonitorInput {
  tipo: 'SITUACAO_FINANCEIRA_INDETERMINADA';
  operacaoId?: string | null;
  cobrancaId?: string | null;
  ordemServicoId: string;
  rodada: number;
  correlationId: string;
  motivo?: string | null;
}

export interface PendenciaFinanceiraMonitorGateway {
  registrar(input: RegistrarPendenciaFinanceiraMonitorInput): Promise<void>;
  resolverPorOperacao(operacaoId: string): Promise<void>;
}
