import { ItensOrcamentoInvalidosError } from '../errors/orcamento.errors';

export type TipoItemOrcamento = 'SERVICO' | 'PECA';

export interface ItemOrcamentoSnapshotProps {
  tipo: TipoItemOrcamento;
  itemId: string;
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
}

export class ItemOrcamentoSnapshot {
  readonly tipo: TipoItemOrcamento;
  readonly itemId: string;
  readonly nome: string;
  readonly quantidade: number;
  readonly precoUnitarioCentavos: number;

  constructor(props: ItemOrcamentoSnapshotProps) {
    this.tipo = props.tipo;
    this.itemId = ItemOrcamentoSnapshot.normalizarId(props.itemId);
    this.nome = ItemOrcamentoSnapshot.normalizarNome(props.nome);
    this.quantidade = ItemOrcamentoSnapshot.normalizarQuantidade(
      props.quantidade,
    );
    this.precoUnitarioCentavos = ItemOrcamentoSnapshot.normalizarPreco(
      props.precoUnitarioCentavos,
    );
  }

  subtotalCentavos(): number {
    return this.quantidade * this.precoUnitarioCentavos;
  }

  private static normalizarId(itemId: string): string {
    const normalizado = itemId?.trim();
    if (!normalizado) {
      throw new ItensOrcamentoInvalidosError('itemId é obrigatório.');
    }
    return normalizado;
  }

  private static normalizarNome(nome: string): string {
    const normalizado = nome?.trim();
    if (!normalizado) {
      throw new ItensOrcamentoInvalidosError('nome do item é obrigatório.');
    }
    return normalizado;
  }

  private static normalizarQuantidade(quantidade: number): number {
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      throw new ItensOrcamentoInvalidosError(
        'quantidade deve ser inteira e positiva.',
      );
    }
    return quantidade;
  }

  private static normalizarPreco(precoUnitarioCentavos: number): number {
    if (
      !Number.isInteger(precoUnitarioCentavos) ||
      precoUnitarioCentavos <= 0
    ) {
      throw new ItensOrcamentoInvalidosError(
        'preço unitário deve ser inteiro positivo em centavos.',
      );
    }
    return precoUnitarioCentavos;
  }
}
