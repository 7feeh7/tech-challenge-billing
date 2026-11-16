import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { Cobranca } from '../../domain/entities/cobranca.entity';

export interface FiltroListarCobrancas {
  ordemServicoId?: string;
  clienteId?: string;
}

export interface CobrancaGateway {
  criar(contexto: ContextoTransacao, cobranca: Cobranca): Promise<Cobranca>;
  buscarPorId(id: string): Promise<Cobranca | null>;
  buscarPorOrcamentoId(orcamentoId: string): Promise<Cobranca | null>;
  listar(
    page: number,
    limit: number,
    filtro: FiltroListarCobrancas,
  ): Promise<{ itens: Cobranca[]; total: number }>;
  atualizar(
    contexto: ContextoTransacao,
    id: string,
    cobranca: Cobranca,
  ): Promise<Cobranca>;
  /** Atualiza somente se a reivindicação (fence) ainda pertence a esta instância. */
  atualizarSePosse(
    contexto: ContextoTransacao,
    id: string,
    cobranca: Cobranca,
    posseAte: Date,
  ): Promise<boolean>;
  reivindicarIntencoesCriacaoOrder(
    limite: number,
    posseMs: number,
  ): Promise<Cobranca[]>;
  reivindicarPendentesConciliacao(
    limite: number,
    posseMs: number,
  ): Promise<Cobranca[]>;
  buscarPorMercadoPagoOrderId(
    mercadoPagoOrderId: string,
  ): Promise<Cobranca | null>;
}
