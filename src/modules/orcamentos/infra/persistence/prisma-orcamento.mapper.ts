import type {
  OrcamentoItem as OrcamentoItemRow,
  Orcamento as OrcamentoRow,
} from '@/shared/generated/prisma/client';
import { Orcamento } from '../../domain/entities/orcamento.entity';
import { SituacaoOrcamento } from '../../domain/situacao-orcamento';

type OrcamentoComItens = OrcamentoRow & { itens: OrcamentoItemRow[] };

export class PrismaOrcamentoMapper {
  static toDomain(raw: OrcamentoComItens): Orcamento {
    return new Orcamento({
      id: raw.id,
      ordemServicoId: raw.ordemServicoId,
      rodada: raw.rodada,
      clienteId: raw.clienteId,
      correlationId: raw.correlationId,
      valorTotalCentavos: raw.valorTotalCentavos,
      situacao: raw.situacao as SituacaoOrcamento,
      motivoRejeicao: raw.motivoRejeicao,
      tentativaAprovacao: raw.tentativaAprovacao,
      rejeitadoEm: raw.rejeitadoEm,
      criadoEm: raw.criadoEm,
      itens: raw.itens.map((item) => ({
        tipo: item.tipo as 'SERVICO' | 'PECA',
        itemId: item.itemId,
        nome: item.nome,
        quantidade: item.quantidade,
        precoUnitarioCentavos: item.precoUnitarioCentavos,
      })),
    });
  }

  static toPersistence(orcamento: Orcamento) {
    return {
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      valorTotalCentavos: orcamento.valorTotalCentavos,
      situacao: orcamento.situacao,
      motivoRejeicao: orcamento.motivoRejeicao,
      tentativaAprovacao: orcamento.tentativaAprovacao,
      rejeitadoEm: orcamento.rejeitadoEm,
      itens: {
        create: orcamento.itens.map((item) => ({
          tipo: item.tipo,
          itemId: item.itemId,
          nome: item.nome,
          quantidade: item.quantidade,
          precoUnitarioCentavos: item.precoUnitarioCentavos,
        })),
      },
    };
  }

  static toUpdatePersistence(orcamento: Orcamento) {
    return {
      valorTotalCentavos: orcamento.valorTotalCentavos,
      situacao: orcamento.situacao,
      motivoRejeicao: orcamento.motivoRejeicao,
      tentativaAprovacao: orcamento.tentativaAprovacao,
      rejeitadoEm: orcamento.rejeitadoEm,
    };
  }
}
