import { OrcamentoNaoEncontradoError } from '../../domain/errors/orcamento.errors';
import { BuscarOrcamentoUseCase } from './buscar-orcamento.use-case';
import { criarGatewayOrcamentoMock, criarOrcamentoFake } from './test-doubles';

describe('BuscarOrcamentoUseCase', () => {
  it('retorna orçamento quando existe', async () => {
    const gateway = criarGatewayOrcamentoMock();
    const fake = criarOrcamentoFake();
    gateway.buscarPorId.mockResolvedValue(fake);

    const useCase = new BuscarOrcamentoUseCase(gateway);
    const saida = await useCase.execute(fake.id as string);

    expect(saida.id).toBe(fake.id);
  });

  it('falha quando não existe', async () => {
    const gateway = criarGatewayOrcamentoMock();
    gateway.buscarPorId.mockResolvedValue(null);
    const useCase = new BuscarOrcamentoUseCase(gateway);

    await expect(useCase.execute('x')).rejects.toThrow(
      OrcamentoNaoEncontradoError,
    );
  });
});