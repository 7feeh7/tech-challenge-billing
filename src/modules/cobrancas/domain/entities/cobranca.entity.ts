import { SituacaoCobrancaInvalidaError } from '../errors/cobranca.errors';
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
  linkPagamento?: string | null;
  pagamentoConfirmadoEm?: Date | null;
  bloqueadoConciliacaoAte?: Date | null;
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
  private _situacao: SituacaoCobranca;
  private _linkPagamento: string | null;
  private _pagamentoConfirmadoEm: Date | null;
  private _bloqueadoConciliacaoAte: Date | null;
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
    this._situacao = props.situacao ?? SituacaoCobranca.INTENCAO;
    this._linkPagamento = props.linkPagamento ?? null;
    this._pagamentoConfirmadoEm = props.pagamentoConfirmadoEm ?? null;
    this._bloqueadoConciliacaoAte = props.bloqueadoConciliacaoAte ?? null;
    this.criadoEm = props.criadoEm ?? new Date();
  }

  get situacao(): SituacaoCobranca {
    return this._situacao;
  }

  get linkPagamento(): string | null {
    return this._linkPagamento;
  }

  get pagamentoConfirmadoEm(): Date | null {
    return this._pagamentoConfirmadoEm;
  }

  get bloqueadoConciliacaoAte(): Date | null {
    return this._bloqueadoConciliacaoAte;
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

  bloquearConciliacao(ate: Date): void {
    this._bloqueadoConciliacaoAte = ate;
  }

  liberarBloqueioConciliacao(): void {
    this._bloqueadoConciliacaoAte = null;
  }

  marcarPendente(linkPagamento: string): void {
    if (
      this._situacao !== SituacaoCobranca.INTENCAO &&
      this._situacao !== SituacaoCobranca.PENDENTE
    ) {
      throw new SituacaoCobrancaInvalidaError(this._situacao, 'marcarPendente');
    }
    this._situacao = SituacaoCobranca.PENDENTE;
    this._linkPagamento = linkPagamento;
    this._bloqueadoConciliacaoAte = null;
  }

  confirmarPagamento(aprovadoEm: Date): void {
    if (this._situacao === SituacaoCobranca.PAGA) {
      return;
    }
    if (this._situacao !== SituacaoCobranca.PENDENTE) {
      throw new SituacaoCobrancaInvalidaError(
        this._situacao,
        'confirmarPagamento',
      );
    }
    this._situacao = SituacaoCobranca.PAGA;
    this._pagamentoConfirmadoEm = aprovadoEm;
    this._bloqueadoConciliacaoAte = null;
  }

  jaPaga(): boolean {
    return this._situacao === SituacaoCobranca.PAGA;
  }

  aindaNoPrazo(agora = new Date()): boolean {
    return agora.getTime() <= this.prazoPagamento.getTime();
  }

  marcarCancelada(): void {
    if (this._situacao === SituacaoCobranca.CANCELADA) {
      return;
    }
    if (
      this._situacao !== SituacaoCobranca.INTENCAO &&
      this._situacao !== SituacaoCobranca.PENDENTE
    ) {
      throw new SituacaoCobrancaInvalidaError(
        this._situacao,
        'marcarCancelada',
      );
    }
    this._situacao = SituacaoCobranca.CANCELADA;
    this._linkPagamento = null;
    this._bloqueadoConciliacaoAte = null;
  }

  iniciarEstorno(): void {
    if (this._situacao === SituacaoCobranca.ESTORNO_EM_ANDAMENTO) {
      return;
    }
    if (this._situacao !== SituacaoCobranca.PAGA) {
      throw new SituacaoCobrancaInvalidaError(this._situacao, 'iniciarEstorno');
    }
    this._situacao = SituacaoCobranca.ESTORNO_EM_ANDAMENTO;
    this._bloqueadoConciliacaoAte = null;
  }

  marcarEstornada(): void {
    if (this._situacao === SituacaoCobranca.ESTORNADA) {
      return;
    }
    if (
      this._situacao !== SituacaoCobranca.ESTORNO_EM_ANDAMENTO &&
      this._situacao !== SituacaoCobranca.PAGA &&
      this._situacao !== SituacaoCobranca.PENDENCIA_MANUAL
    ) {
      throw new SituacaoCobrancaInvalidaError(
        this._situacao,
        'marcarEstornada',
      );
    }
    this._situacao = SituacaoCobranca.ESTORNADA;
    this._bloqueadoConciliacaoAte = null;
  }

  marcarPendenciaManual(): void {
    if (this._situacao === SituacaoCobranca.PENDENCIA_MANUAL) {
      return;
    }
    if (this._situacao !== SituacaoCobranca.PAGA) {
      throw new SituacaoCobrancaInvalidaError(
        this._situacao,
        'marcarPendenciaManual',
      );
    }
    this._situacao = SituacaoCobranca.PENDENCIA_MANUAL;
    this._bloqueadoConciliacaoAte = null;
  }
}
