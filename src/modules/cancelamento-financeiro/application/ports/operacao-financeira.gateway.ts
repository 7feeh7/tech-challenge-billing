import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export type SituacaoOperacaoFinanceiraRegistro = 'EM_ANDAMENTO' | 'CONCLUIDA';

export type ResultadoCancelamentoFinanceiroRegistro =
  | 'NADA_A_CANCELAR'
  | 'CANCELADA'
  | 'ESTORNADA'
  | 'PENDENCIA_MANUAL_ABERTA';

export interface OperacaoFinanceiraRegistro {
  id: string;
  eventId: string;
  ordemServicoId: string;
  rodada: number;
  correlationId: string;
  situacao: SituacaoOperacaoFinanceiraRegistro;
  chaveIdempotenciaMercadoPago: string;
  resultadoExecucao: 'REPARO_NAO_INICIADO' | 'REPARO_INICIADO';
  motivoCancelamento?: string | null;
  etapaOrigem?: string | null;
  cobrancaId?: string | null;
  resultado?: ResultadoCancelamentoFinanceiroRegistro | null;
  pendenciaId?: string | null;
  bloqueadoProcessamentoAte?: Date | null;
  tentativasMercadoPago: number;
}

export interface CriarOperacaoFinanceiraInput {
  eventId: string;
  ordemServicoId: string;
  rodada: number;
  correlationId: string;
  chaveIdempotenciaMercadoPago: string;
  resultadoExecucao: 'REPARO_NAO_INICIADO' | 'REPARO_INICIADO';
  motivoCancelamento?: string | null;
  etapaOrigem?: string | null;
}

export interface OperacaoFinanceiraGateway {
  buscarPorId(id: string): Promise<OperacaoFinanceiraRegistro | null>;
  buscarPorEventId(
    contexto: ContextoTransacao,
    eventId: string,
  ): Promise<OperacaoFinanceiraRegistro | null>;
  criar(
    contexto: ContextoTransacao,
    input: CriarOperacaoFinanceiraInput,
  ): Promise<OperacaoFinanceiraRegistro>;
  concluir(
    contexto: ContextoTransacao,
    id: string,
    dados: {
      cobrancaId?: string | null;
      resultado: ResultadoCancelamentoFinanceiroRegistro;
      pendenciaId?: string | null;
    },
  ): Promise<void>;
  adiarProcessamento(id: string, ate: Date): Promise<void>;
  incrementarTentativasMercadoPago(id: string): Promise<void>;
  reivindicarEmAndamento(
    limite: number,
    posseMs: number,
  ): Promise<OperacaoFinanceiraRegistro[]>;
}
