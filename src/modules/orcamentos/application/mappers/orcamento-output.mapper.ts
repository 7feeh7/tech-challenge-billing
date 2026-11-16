import type { Orcamento } from '../../domain/entities/orcamento.entity';

export interface OrcamentoItemOutput {
  tipo: string;
  itemId: string;
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
}

export interface OrcamentoOutput {
  id: string;
  ordemServicoId: string;
  rodada: number;
  clienteId: string;
  valorTotalCentavos: number;
  situacao: string;
  motivoRejeicao: string | null;
  tentativaAprovacao: number;
  itens: OrcamentoItemOutput[];
  rejeitadoEm: string | null;
  criadoEm: string;
}

export interface ListagemOrcamentosOutput {
  itens: OrcamentoOutput[];
  total: number;
  page: number;
  limit: number;
}

export class OrcamentoOutputMapper {
  static toOutput(orcamento: Orcamento): OrcamentoOutput {
    if (!orcamento.id) {
      throw new Error('Orçamento sem id não pode ser exposto na API.');
    }

    return {
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      valorTotalCentavos: orcamento.valorTotalCentavos,
      situacao: orcamento.situacao,
      motivoRejeicao: orcamento.motivoRejeicao,
      tentativaAprovacao: orcamento.tentativaAprovacao,
      itens: orcamento.itens.map((item) => ({
        tipo: item.tipo,
        itemId: item.itemId,
        nome: item.nome,
        quantidade: item.quantidade,
        precoUnitarioCentavos: item.precoUnitarioCentavos,
      })),
      rejeitadoEm: orcamento.rejeitadoEm?.toISOString() ?? null,
      criadoEm: orcamento.criadoEm.toISOString(),
    };
  }
}
