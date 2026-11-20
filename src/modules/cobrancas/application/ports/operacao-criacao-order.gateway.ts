import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export interface OperacaoCriacaoOrderRegistro {
  id?: string;
  cobrancaId: string;
  chaveIdempotencia: string;
  situacao: 'EM_ANDAMENTO' | 'CONCLUIDA';
}

export interface OperacaoCriacaoOrderGateway {
  obterPorCobrancaId(
    cobrancaId: string,
  ): Promise<OperacaoCriacaoOrderRegistro | null>;
  garantirEmAndamento(
    contexto: ContextoTransacao,
    cobrancaId: string,
    chaveIdempotencia: string,
  ): Promise<OperacaoCriacaoOrderRegistro>;
  marcarConcluida(
    contexto: ContextoTransacao,
    cobrancaId: string,
  ): Promise<void>;
  garantirReemissaoEmAndamento(
    contexto: ContextoTransacao,
    cobrancaId: string,
  ): Promise<string>;
}
