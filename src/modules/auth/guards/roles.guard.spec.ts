import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { PerfilUsuario } from '../perfil-usuario';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const guard = new RolesGuard(reflector);

  it('permite quando perfil exigido coincide', () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValue([PerfilUsuario.ADMINISTRADOR]);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { perfil: PerfilUsuario.ADMINISTRADOR },
        }),
      }),
    } as never;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('nega quando perfil não coincide', () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValue([PerfilUsuario.ADMINISTRADOR]);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { perfil: 'CLIENTE' } }),
      }),
    } as never;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});