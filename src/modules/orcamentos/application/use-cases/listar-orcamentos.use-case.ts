import {
  type ListagemOrcamentosOutput,
  OrcamentoOutputMapper,
} from '../mappers/orcamento-output.mapper';
import type { OrcamentoGateway } from '../ports/orcamento.gateway';

export interface ListarOrcamentosFiltro {
  ordemServicoId?: string;
  clienteId?: string;
}

export class ListarOrcamentosUseCase {
  constructor(private readonly orcamentos: OrcamentoGateway) {}

  async execute(
    page: number,
    limit: number,
    filtro: ListarOrcamentosFiltro = {},
  ): Promise<ListagemOrcamentosOutput> {
    const { itens, total } = await this.orcamentos.listar(page, limit, filtro);

    return {
      itens: itens.map((o) => OrcamentoOutputMapper.toOutput(o)),
      total,
      page,
      limit,
    };
  }
}
