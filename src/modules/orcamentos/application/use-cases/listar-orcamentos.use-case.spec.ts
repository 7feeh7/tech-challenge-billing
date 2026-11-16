import { ListarOrcamentosUseCase } from './listar-orcamentos.use-case';
import { criarGatewayOrcamentoMock, criarOrcamentoFake } from './test-doubles';

describe('ListarOrcamentosUseCase', () => {
  it('mapeia itens da listagem', async () => {
    const gateway = criarGatewayOrcamentoMock();
    const fake = criarOrcamentoFake();
    gateway.listar.mockResolvedValue({ itens: [fake], total: 1 });

    const useCase = new ListarOrcamentosUseCase(gateway);
    const saida = await useCase.execute(1, 10, { clienteId: fake.clienteId });

    expect(saida.total).toBe(1);
    expect(saida.itens[0]?.id).toBe(fake.id);
  });
});