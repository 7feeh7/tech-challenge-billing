import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const jwtService = {
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ISSUER') return 'tech-challenge-auth';
      if (key === 'JWT_AUDIENCE') return 'tech-challenge-api';
      return undefined;
    }),
    getOrThrow: jest.fn(() => 'chave-publica-rs256'),
  } as unknown as ConfigService;

  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;

  const guard = new JwtAuthGuard(jwtService, reflector, configService);

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: 'Bearer token' },
      }),
    }),
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride = jest.fn().mockReturnValue(false);
  });

  it('aceita token interno valido com RS256', async () => {
    jwtService.verifyAsync = jest.fn().mockResolvedValue({
      sub: 'usuario-1',
      email: 'a@b.com',
      perfil: 'ADMINISTRADOR',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({ algorithms: ['RS256'] }),
    );
  });

  it('aceita rota pública sem token', async () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const ctxPublico = {
      ...context,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as never;
    await expect(guard.canActivate(ctxPublico)).resolves.toBe(true);
  });

  it('rejeita token interno sem email', async () => {
    jwtService.verifyAsync = jest.fn().mockResolvedValue({
      sub: 'u1',
      perfil: 'ADMINISTRADOR',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejeita quando token ausente', async () => {
    const ctxSemToken = {
      ...context,
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as never;

    await expect(guard.canActivate(ctxSemToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});