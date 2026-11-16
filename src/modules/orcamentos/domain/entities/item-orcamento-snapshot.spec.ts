import { ItensOrcamentoInvalidosError } from '../errors/orcamento.errors';
import { ItemOrcamentoSnapshot } from './item-orcamento-snapshot';

describe('ItemOrcamentoSnapshot', () => {
  const valido = {
    tipo: 'SERVICO' as const,
    itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    nome: 'Serviço',
    quantidade: 2,
    precoUnitarioCentavos: 1000,
  };

  it('calcula subtotal', () => {
    expect(new ItemOrcamentoSnapshot(valido).subtotalCentavos()).toBe(2000);
  });

  it('rejeita quantidade inválida', () => {
    expect(
      () => new ItemOrcamentoSnapshot({ ...valido, quantidade: 0 }),
    ).toThrow(ItensOrcamentoInvalidosError);
  });

  it('rejeita preço inválido', () => {
    expect(
      () =>
        new ItemOrcamentoSnapshot({ ...valido, precoUnitarioCentavos: -1 }),
    ).toThrow(ItensOrcamentoInvalidosError);
  });
});