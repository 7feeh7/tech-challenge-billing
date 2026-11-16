import { Test } from '@nestjs/testing';
import { BuscarOrcamentoUseCase } from '@/modules/orcamentos/application/use-cases/buscar-orcamento.use-case';
import { ListarOrcamentosUseCase } from '@/modules/orcamentos/application/use-cases/listar-orcamentos.use-case';
import { RejeitarOrcamentoUseCase } from '@/modules/orcamentos/application/use-cases/rejeitar-orcamento.use-case';
import { OrcamentosController } from './orcamentos.controller';

describe('OrcamentosController', () => {
  let controller: OrcamentosController;
  const buscar = { execute: jest.fn() };
  const listar = { execute: jest.fn() };
  const rejeitar = { execute: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrcamentosController],
      providers: [
        { provide: BuscarOrcamentoUseCase, useValue: buscar },
        { provide: ListarOrcamentosUseCase, useValue: listar },
        { provide: RejeitarOrcamentoUseCase, useValue: rejeitar },
      ],
    }).compile();

    controller = module.get(OrcamentosController);
    jest.clearAllMocks();
  });

  it('lista orçamentos', async () => {
    listar.execute.mockResolvedValue({
      itens: [],
      total: 0,
      page: 1,
      limit: 10,
    });
    await controller.findAll(1, 10, undefined, {});
    expect(listar.execute).toHaveBeenCalled();
  });

  it('filtra por cliente autenticado', async () => {
    listar.execute.mockResolvedValue({
      itens: [],
      total: 0,
      page: 1,
      limit: 10,
    });
    await controller.findAll(1, 10, 'os-1', {
      user: { sub: 'cliente-1', tipo: 'CLIENTE', perfil: 'CLIENTE' },
    } as never);
    expect(listar.execute).toHaveBeenCalledWith(1, 10, {
      ordemServicoId: 'os-1',
      clienteId: 'cliente-1',
    });
  });

  it('busca por id', async () => {
    buscar.execute.mockResolvedValue({ id: '1' });
    await controller.findOne('1');
    expect(buscar.execute).toHaveBeenCalledWith('1');
  });

  it('rejeita orçamento', async () => {
    rejeitar.execute.mockResolvedValue({ situacao: 'REJEITADO' });
    await controller.rejeicao('1', { motivo: 'Não' });
    expect(rejeitar.execute).toHaveBeenCalledWith('1', { motivo: 'Não' });
  });
});
