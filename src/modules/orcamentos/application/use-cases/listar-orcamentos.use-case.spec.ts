import { ListarOrcamentosUseCase } from './listar-orcamentos.use-case';
import { criarGatewayOrcamentoMock, criarOrcamentoFake } from './test-doubles';

describe('ListarOrcamentosUseCase', () => {
  it('lista sem filtros opcionais', async () => {
    const gateway = criarGatewayOrcamentoMock();
    gateway.listar.mockResolvedValue({ itens: [], total: 0 });
    const useCase = new ListarOrcamentosUseCase(gateway);

    await useCase.execute(1, 10);

    expect(gateway.listar).toHaveBeenCalledWith(1, 10, {});
  });

  it('mapeia itens da listagem', async () => {
    const gateway = criarGatewayOrcamentoMock();
    const fake = criarOrcamentoFake();
    gateway.listar.mockResolvedValue({ itens: [fake], total: 1 });

    const useCase = new ListarOrcamentosUseCase(gateway);
    const saida = await useCase.execute(1, 10, { clienteId: fake.clienteId });

    expect(saida.total).toBe(1);
    expect(saida.itens[0]?.id).toBe(fake.id);
  });

  it('repassa filtro por ordem de serviço', async () => {
    const gateway = criarGatewayOrcamentoMock();
    gateway.listar.mockResolvedValue({ itens: [], total: 0 });
    const useCase = new ListarOrcamentosUseCase(gateway);

    await useCase.execute(1, 5, { ordemServicoId: 'os-1' });

    expect(gateway.listar).toHaveBeenCalledWith(1, 5, {
      ordemServicoId: 'os-1',
    });
  });
});
