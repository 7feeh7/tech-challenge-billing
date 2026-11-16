export const EVENTO_GERAR_ORCAMENTO = 'billing.gerar-orcamento.v1';
export const EVENTO_ORCAMENTO_GERADO = 'billing.orcamento-gerado.v1';
export const EVENTO_ORCAMENTO_REJEITADO = 'billing.orcamento-rejeitado.v1';
export const EVENTO_COBRANCA_CRIADA = 'billing.cobranca-criada.v1';
export const EVENTO_PAGAMENTO_CONFIRMADO = 'billing.pagamento-confirmado.v1';
export const EVENTO_CANCELAR_FINANCEIRO = 'billing.cancelar-financeiro.v1';
export const EVENTO_RESPOSTA_CANCELAMENTO =
  'billing.resposta-cancelamento-financeiro.v1';
export const EVENTO_PENDENCIA_RESOLVIDA = 'billing.pendencia-resolvida.v1';
export const EVENTO_ESTORNO_CONCLUIDO = 'billing.estorno-concluido.v1';
export const EVENTO_COBRANCA_EXPIRADA = 'billing.cobranca-expirada.v1';
export const EVENTO_PAGAMENTO_TARDIO_REGISTRADO =
  'billing.pagamento-tardio-registrado.v1';
export const EVENTO_CONSULTAR_SITUACAO_FINANCEIRA =
  'billing.consultar-situacao-financeira.v1';
export const EVENTO_SITUACAO_FINANCEIRA = 'billing.situacao-financeira.v1';

export const DESTINO_FILA_OS = 'os-in';

export interface ItemSnapshotPayload {
  tipo: 'SERVICO' | 'PECA';
  itemId: string;
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
}

export interface EnvelopeMensagem<T = unknown> {
  eventId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  source: string;
  correlationId: string;
  causationId: string | null;
  ordemServicoId: string;
  rodada: number;
  payload: T;
}

export interface PayloadGerarOrcamento {
  clienteId: string;
  itens: ItemSnapshotPayload[];
}

export interface PayloadOrcamentoGerado {
  orcamentoId: string;
  valorTotalCentavos: number;
}

export interface PayloadOrcamentoRejeitado {
  orcamentoId: string;
  motivo: string;
}

export interface PayloadCobrancaCriada {
  cobrancaId: string;
  orderId: string;
  linkPagamento: string;
  prazoPagamento: string;
  valorCentavos: number;
}

export interface PayloadPagamentoConfirmado {
  cobrancaId: string;
  orderId: string;
  aprovadoEm: string;
  valorCentavos: number;
}

export interface PayloadCancelarFinanceiro {
  etapaOrigem: string;
  motivo: string;
  resultadoExecucao: 'REPARO_NAO_INICIADO' | 'REPARO_INICIADO';
}

export type ResultadoRespostaCancelamentoFinanceiro =
  | 'NADA_A_CANCELAR'
  | 'CANCELADA'
  | 'ESTORNADA'
  | 'PENDENCIA_MANUAL_ABERTA';

export interface PayloadRespostaCancelamentoFinanceiro {
  resultado: ResultadoRespostaCancelamentoFinanceiro;
  pendenciaId: string | null;
}

export interface PayloadPendenciaResolvida {
  pendenciaId: string;
  decisao: 'ESTORNO_INTEGRAL' | 'ESTORNO_PARCIAL' | 'SEM_ESTORNO';
  valorEstornadoCentavos: number;
}

export interface PayloadEstornoConcluido {
  cobrancaId: string;
  orderId: string;
  valorEstornadoCentavos: number;
  estornadoEm: string;
  tipoEstorno: 'INTEGRAL' | 'PARCIAL';
  statusOrderMercadoPago: string;
}

export type FinalidadeConsultaSituacaoFinanceira =
  | 'PRAZO_DE_REFERENCIA_VENCIDO'
  | 'EXCECAO_E10';

export interface PayloadConsultarSituacaoFinanceira {
  consultaId: string;
  finalidade: FinalidadeConsultaSituacaoFinanceira;
}

export type SituacaoPagamentoConsulta =
  | 'PAGO_NO_PRAZO'
  | 'SEM_PAGAMENTO'
  | 'INDETERMINADA';

export type SituacaoEstornoConsulta =
  | 'NENHUM'
  | 'EM_ANDAMENTO'
  | 'REALIZADO'
  | 'INDETERMINADO';

export interface PayloadSituacaoFinanceira {
  consultaId: string;
  situacaoPagamento: SituacaoPagamentoConsulta;
  situacaoEstorno: SituacaoEstornoConsulta;
  cobrancaId: string;
  orderId?: string;
  aprovadoEm?: string;
  valorCentavos?: number;
}

export interface PayloadCobrancaExpirada {
  cobrancaId: string;
  expiradaEm: string;
  orderId: string;
  statusOrderMercadoPago: string;
  statusDetailMercadoPago: string;
}

export interface PayloadPagamentoTardioRegistrado {
  cobrancaId: string;
  orderId: string;
  aprovadoEm: string;
  tratamento: 'ESTORNO_AUTOMATICO';
}
