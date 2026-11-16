import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export type SituacaoPendenciaRegistro = 'ABERTA' | 'RESOLVIDA';

export type DecisaoPendenciaRegistro =
  | 'ESTORNO_INTEGRAL'
  | 'ESTORNO_PARCIAL'
  | 'SEM_ESTORNO';

export interface PendenciaEstornoRegistro {
  id: string;
  cobrancaId: string;
  ordemServicoId: string;
  rodada: number;
  valorCobrancaCentavos: number;
  situacao: SituacaoPendenciaRegistro;
  motivoAbertura: string;
  responsavelId?: string | null;
  decisao?: DecisaoPendenciaRegistro | null;
  valorEstornadoCentavos?: number | null;
  justificativa?: string | null;
  resolvidaEm?: Date | null;
}

export interface CriarPendenciaEstornoInput {
  cobrancaId: string;
  ordemServicoId: string;
  rodada: number;
  valorCobrancaCentavos: number;
  motivoAbertura: string;
}

export interface PendenciaEstornoGateway {
  criar(
    contexto: ContextoTransacao,
    input: CriarPendenciaEstornoInput,
  ): Promise<PendenciaEstornoRegistro>;
  buscarPorId(id: string): Promise<PendenciaEstornoRegistro | null>;
  listarAbertas(
    page: number,
    limit: number,
  ): Promise<{ itens: PendenciaEstornoRegistro[]; total: number }>;
  resolver(
    contexto: ContextoTransacao,
    id: string,
    dados: {
      responsavelId: string;
      decisao: DecisaoPendenciaRegistro;
      valorEstornadoCentavos?: number | null;
      justificativa?: string | null;
    },
  ): Promise<PendenciaEstornoRegistro>;
}
