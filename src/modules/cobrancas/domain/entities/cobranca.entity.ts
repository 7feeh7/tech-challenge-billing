import { SituacaoCobranca } from '../situacao-cobranca';

export interface CobrancaProps {
  id?: string;
  orcamentoId: string;
  ordemServicoId: string;
  rodada: number;
  clienteId: string;
  correlationId: string;
  valorTotalCentavos: number;
  prazoPagamento: Date;
  situacao?: SituacaoCobranca;
  criadoEm?: Date;
}

export class Cobranca {
  readonly id?: string;
  readonly orcamentoId: string;
  readonly ordemServicoId: string;
  readonly rodada: number;
  readonly clienteId: string;
  readonly correlationId: string;
  readonly valorTotalCentavos: number;
  readonly prazoPagamento: Date;
  readonly situacao: SituacaoCobranca;
  readonly criadoEm: Date;

  constructor(props: CobrancaProps) {
    this.id = props.id;
    this.orcamentoId = props.orcamentoId;
    this.ordemServicoId = props.ordemServicoId;
    this.rodada = props.rodada;
    this.clienteId = props.clienteId;
    this.correlationId = props.correlationId;
    this.valorTotalCentavos = props.valorTotalCentavos;
    this.prazoPagamento = props.prazoPagamento;
    this.situacao = props.situacao ?? SituacaoCobranca.INTENCAO;
    this.criadoEm = props.criadoEm ?? new Date();
  }

  static criarIntencaoAPartirDoOrcamento(params: {
    orcamentoId: string;
    ordemServicoId: string;
    rodada: number;
    clienteId: string;
    correlationId: string;
    valorTotalCentavos: number;
    prazoPagamento: Date;
  }): Cobranca {
    return new Cobranca({
      orcamentoId: params.orcamentoId,
      ordemServicoId: params.ordemServicoId,
      rodada: params.rodada,
      clienteId: params.clienteId,
      correlationId: params.correlationId,
      valorTotalCentavos: params.valorTotalCentavos,
      prazoPagamento: params.prazoPagamento,
      situacao: SituacaoCobranca.INTENCAO,
    });
  }
}
