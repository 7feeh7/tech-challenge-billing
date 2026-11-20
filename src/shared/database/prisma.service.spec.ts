import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));

describe('PrismaService', () => {
  it('instancia com parâmetros de pool da configuração', () => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue('postgresql://localhost/ci'),
      get: jest.fn((key: string) => {
        if (key === 'DATABASE_SSL') return 'false';
        if (key === 'DATABASE_POOL_MAX') return '3';
        if (key === 'DATABASE_POOL_CONNECTION_TIMEOUT_MS') return '5000';
        return undefined;
      }),
    } as unknown as ConfigService;

    const service = new PrismaService(config);
    expect(service).toBeDefined();
    expect(config.getOrThrow).toHaveBeenCalledWith('DATABASE_URL');
  });

  it('habilita SSL quando DATABASE_SSL é true', () => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue('postgresql://localhost/ci'),
      get: jest.fn((key: string) => {
        if (key === 'DATABASE_SSL') return 'true';
        return undefined;
      }),
    } as unknown as ConfigService;

    expect(() => new PrismaService(config)).not.toThrow();
  });

  it('conecta e desconecta no ciclo de vida do módulo', async () => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue('postgresql://localhost/ci'),
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const service = new PrismaService(config);
    const connect = jest
      .spyOn(
        service as unknown as { $connect: () => Promise<void> },
        '$connect',
      )
      .mockResolvedValue();
    const disconnect = jest
      .spyOn(
        service as unknown as { $disconnect: () => Promise<void> },
        '$disconnect',
      )
      .mockResolvedValue();

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
