import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  OwnershipResource,
  OWNERSHIP_KEY,
} from '../decorators/ownership.decorator';
import { OwnershipGuard } from './ownership.guard';

describe('OwnershipGuard', () => {
  const prisma = {
    orcamento: { findUnique: jest.fn() },
  };
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new OwnershipGuard(reflector, prisma as never);

  it('libera atendente sem checar posse', async () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValue(OwnershipResource.ORCAMENTO);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { perfil: 'ADMINISTRADOR' },
          params: { id: 'orc-1' },
        }),
      }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(OWNERSHIP_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('permite cliente dono do orçamento', async () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValue(OwnershipResource.ORCAMENTO);
    prisma.orcamento.findUnique.mockResolvedValue({ clienteId: 'cliente-1' });
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: 'cliente-1', tipo: 'CLIENTE', perfil: 'CLIENTE' },
          params: { id: 'orc-1' },
        }),
      }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('nega cliente em orçamento de outro', async () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValue(OwnershipResource.ORCAMENTO);
    prisma.orcamento.findUnique.mockResolvedValue({ clienteId: 'outro' });
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: 'cliente-1', tipo: 'CLIENTE', perfil: 'CLIENTE' },
          params: { id: 'orc-1' },
        }),
      }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});