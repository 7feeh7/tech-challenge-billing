import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { Orcamento } from '../../domain/entities/orcamento.entity';

export interface OrcamentoGateway {
  buscarPorId(id: string): Promise<Orcamento | null>;
  buscarPorOrdemServicoERodada(
    contexto: ContextoTransacao,
    ordemServicoId: string,
    rodada: number,
  ): Promise<Orcamento | null>;
  criar(contexto: ContextoTransacao, orcamento: Orcamento): Promise<Orcamento>;
  atualizar(
    contexto: ContextoTransacao,
    id: string,
    orcamento: Orcamento,
  ): Promise<Orcamento>;
  listar(
    page: number,
    limit: number,
    filtros: { ordemServicoId?: string; clienteId?: string },
  ): Promise<{ itens: Orcamento[]; total: number }>;
}
