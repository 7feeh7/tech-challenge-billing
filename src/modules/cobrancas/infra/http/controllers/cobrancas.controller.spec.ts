import { PerfilCliente } from '@/modules/auth/perfil-autorizacao';
import { CobrancasController } from './cobrancas.controller';

describe('CobrancasController', () => {
  it('lista cobranças com filtro de cliente', async () => {
    const listar = {
      execute: jest
        .fn()
        .mockResolvedValue({ itens: [], total: 0, page: 1, limit: 10 }),
    };
    const controller = new CobrancasController(listar as never);
    await controller.findAll(1, 10, 'os-1', {
      user: { sub: 'cliente-1', tipo: PerfilCliente, perfil: PerfilCliente },
    } as never);
    expect(listar.execute).toHaveBeenCalledWith(1, 10, {
      ordemServicoId: 'os-1',
      clienteId: 'cliente-1',
    });
  });
});
