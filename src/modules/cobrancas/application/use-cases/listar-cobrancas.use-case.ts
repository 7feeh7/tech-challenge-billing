import {
  type CobrancaOutput,
  CobrancaOutputMapper,
} from '../mappers/cobranca-output.mapper';
import type { CobrancaGateway } from '../ports/cobranca.gateway';

export class ListarCobrancasUseCase {
  constructor(private readonly cobrancas: CobrancaGateway) {}

  async execute(
    page: number,
    limit: number,
    filtro: { ordemServicoId?: string; clienteId?: string },
  ): Promise<{
    itens: CobrancaOutput[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { itens, total } = await this.cobrancas.listar(page, limit, filtro);
    return {
      page,
      limit,
      total,
      itens: itens.map((c) => CobrancaOutputMapper.toOutput(c)),
    };
  }
}
