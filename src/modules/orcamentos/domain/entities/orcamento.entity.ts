import {
  ItensOrcamentoInvalidosError,
  MotivoRejeicaoObrigatorioError,
  SituacaoOrcamentoInvalidaError,
} from '../errors/orcamento.errors';
import { SituacaoOrcamento } from '../situacao-orcamento';
import {
  ItemOrcamentoSnapshot,
  type ItemOrcamentoSnapshotProps,
} from './item-orcamento-snapshot';

export interface OrcamentoProps {
  id?: string;
  ordemServicoId: string;
  rodada: number;
  clienteId: string;
  correlationId: string;
  valorTotalCentavos?: number;
  situacao?: SituacaoOrcamento;
  itens: ItemOrcamentoSnapshotProps[];
  motivoRejeicao?: string | null;
  tentativaAprovacao?: number;
  rejeitadoEm?: Date | null;
  criadoEm?: Date;
}

export class Orcamento {
  readonly id?: string;
  readonly ordemServicoId: string;
  readonly rodada: number;
  readonly clienteId: string;
  readonly correlationId: string;
  readonly itens: ItemOrcamentoSnapshot[];
  private _valorTotalCentavos: number;
  private _situacao: SituacaoOrcamento;
  private _motivoRejeicao: string | null;
  private _tentativaAprovacao: number;
  private _rejeitadoEm: Date | null;
  readonly criadoEm: Date;

  constructor(props: OrcamentoProps) {
    this.id = props.id;
    this.ordemServicoId = Orcamento.normalizarUuid(
      props.ordemServicoId,
      'ordemServicoId',
    );
    this.rodada = Orcamento.normalizarRodada(props.rodada);
    this.clienteId = Orcamento.normalizarUuid(props.clienteId, 'clienteId');
    this.correlationId = Orcamento.normalizarUuid(
      props.correlationId,
      'correlationId',
    );
    this.itens = props.itens.map((item) => new ItemOrcamentoSnapshot(item));
    this._valorTotalCentavos =
      props.valorTotalCentavos ?? Orcamento.calcularValorTotal(this.itens);
    this._situacao = props.situacao ?? SituacaoOrcamento.GERADO;
    this._motivoRejeicao = Orcamento.normalizarTexto(props.motivoRejeicao);
    this._tentativaAprovacao = props.tentativaAprovacao ?? 0;
    this._rejeitadoEm = props.rejeitadoEm ?? null;
    this.criadoEm = props.criadoEm ?? new Date();
  }

  get valorTotalCentavos() {
    return this._valorTotalCentavos;
  }
  get situacao() {
    return this._situacao;
  }
  get motivoRejeicao() {
    return this._motivoRejeicao;
  }
  get tentativaAprovacao() {
    return this._tentativaAprovacao;
  }
  get rejeitadoEm() {
    return this._rejeitadoEm;
  }

  rejeitar(motivo: string, agora: Date = new Date()): void {
    if (this._situacao !== SituacaoOrcamento.GERADO) {
      throw new SituacaoOrcamentoInvalidaError(this._situacao, 'rejeitar');
    }

    const motivoNormalizado = Orcamento.normalizarTexto(motivo);
    if (!motivoNormalizado) {
      throw new MotivoRejeicaoObrigatorioError();
    }

    this._situacao = SituacaoOrcamento.REJEITADO;
    this._motivoRejeicao = motivoNormalizado;
    this._rejeitadoEm = agora;
  }

  static calcularValorTotal(itens: ItemOrcamentoSnapshot[]): number {
    if (itens.length === 0) {
      throw new ItensOrcamentoInvalidosError(
        'O orçamento precisa de ao menos um item.',
      );
    }
    return itens.reduce((soma, item) => soma + item.subtotalCentavos(), 0);
  }

  private static normalizarRodada(rodada: number): number {
    if (!Number.isInteger(rodada) || rodada < 1) {
      throw new SituacaoOrcamentoInvalidaError('?', 'criar orçamento');
    }
    return rodada;
  }

  private static normalizarUuid(valor: string, campo: string): string {
    const normalizado = valor?.trim();
    if (!normalizado) {
      throw new SituacaoOrcamentoInvalidaError('?', `informar ${campo}`);
    }
    return normalizado;
  }

  private static normalizarTexto(texto?: string | null): string | null {
    const normalizado = texto?.trim();
    return normalizado ? normalizado : null;
  }
}
