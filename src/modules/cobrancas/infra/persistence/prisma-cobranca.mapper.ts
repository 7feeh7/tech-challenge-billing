import type { Cobranca as CobrancaRow } from '@/shared/generated/prisma/client';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';

export class PrismaCobrancaMapper {
  static toDomain(raw: CobrancaRow): Cobranca {
    return new Cobranca({
      id: raw.id,
      orcamentoId: raw.orcamentoId,
      ordemServicoId: raw.ordemServicoId,
      rodada: raw.rodada,
      clienteId: raw.clienteId,
      correlationId: raw.correlationId,
      valorTotalCentavos: raw.valorTotalCentavos,
      prazoPagamento: raw.prazoPagamento,
      situacao: raw.situacao as SituacaoCobranca,
      criadoEm: raw.criadoEm,
    });
  }

  static toPersistence(cobranca: Cobranca) {
    return {
      orcamentoId: cobranca.orcamentoId,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      clienteId: cobranca.clienteId,
      correlationId: cobranca.correlationId,
      valorTotalCentavos: cobranca.valorTotalCentavos,
      prazoPagamento: cobranca.prazoPagamento,
      situacao: cobranca.situacao,
    };
  }
}
