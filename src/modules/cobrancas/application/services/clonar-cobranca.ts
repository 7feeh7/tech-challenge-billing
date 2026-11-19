import { Cobranca } from '../../domain/entities/cobranca.entity';

// A entidade só muda por métodos de transição: transicionar uma cópia evita
// alterar o objeto lido antes de a transação gravar o resultado.
export function clonarCobranca(cobranca: Cobranca): Cobranca {
  return new Cobranca({
    id: cobranca.id,
    orcamentoId: cobranca.orcamentoId,
    ordemServicoId: cobranca.ordemServicoId,
    rodada: cobranca.rodada,
    clienteId: cobranca.clienteId,
    correlationId: cobranca.correlationId,
    valorTotalCentavos: cobranca.valorTotalCentavos,
    prazoPagamento: cobranca.prazoPagamento,
    situacao: cobranca.situacao,
    linkPagamento: cobranca.linkPagamento,
    pagamentoConfirmadoEm: cobranca.pagamentoConfirmadoEm,
    bloqueadoConciliacaoAte: cobranca.bloqueadoConciliacaoAte,
    criadoEm: cobranca.criadoEm,
  });
}
