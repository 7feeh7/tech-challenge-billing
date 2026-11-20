import type { Cobranca } from '../../domain/entities/cobranca.entity';

export interface CobrancaOutput {
  id: string;
  orcamentoId: string;
  ordemServicoId: string;
  rodada: number;
  clienteId: string;
  situacao: string;
  valorTotalCentavos: number;
  prazoPagamento: string;
  linkPagamento: string | null;
  pagamentoConfirmadoEm: string | null;
}

export class CobrancaOutputMapper {
  static toOutput(cobranca: Cobranca): CobrancaOutput {
    return {
      id: cobranca.id as string,
      orcamentoId: cobranca.orcamentoId,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      clienteId: cobranca.clienteId,
      situacao: cobranca.situacao,
      valorTotalCentavos: cobranca.valorTotalCentavos,
      prazoPagamento: cobranca.prazoPagamento.toISOString(),
      linkPagamento: cobranca.linkPagamento,
      pagamentoConfirmadoEm: cobranca.pagamentoConfirmadoEm
        ? cobranca.pagamentoConfirmadoEm.toISOString()
        : null,
    };
  }
}
