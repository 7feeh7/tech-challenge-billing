import { ConfigService } from '@nestjs/config';
import { DESTINO_FILA_OS } from '../../envelope';
import { PublicadorOutboxService } from './publicador-outbox.service';

describe('PublicadorOutboxService', () => {
  it('não agenda publicação quando desabilitado', () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'OUTBOX_PUBLISHER_HABILITADO') return 'false';
        return undefined;
      }),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const service = new PublicadorOutboxService(
      { $transaction: jest.fn() } as never,
      config,
      { enviar: jest.fn() } as never,
    );

    service.onModuleInit();
    expect((service as { intervalo?: unknown }).intervalo).toBeUndefined();
  });

  it('publica mensagens reivindicadas e marca como enviadas', async () => {
    const mensagem = {
      id: 'm1',
      destino: DESTINO_FILA_OS,
      envelope: {
        eventId: 'e1',
        eventType: 'billing.orcamento-gerado.v1',
        version: 1,
        occurredAt: 't',
        source: 'billing',
        correlationId: 'c',
        causationId: null,
        ordemServicoId: 'os',
        rodada: 1,
        payload: {},
      },
      correlationId: 'c',
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: jest
            .fn()
            .mockResolvedValue([{ id: 'm1', destino: DESTINO_FILA_OS }]),
          mensagemOutbox: {
            updateMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([mensagem]),
          },
        }),
      ),
      mensagemOutbox: { update: jest.fn() },
    };
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'OUTBOX_PUBLISHER_HABILITADO') return 'true';
        if (k === 'OUTBOX_PUBLISHER_INTERVAL_MS') return '99999';
        if (k === 'OUTBOX_REIVINDICACAO_MS') return '30000';
        return undefined;
      }),
      getOrThrow: jest.fn().mockReturnValue('https://sqs/os'),
    } as unknown as ConfigService;

    const service = new PublicadorOutboxService(
      prisma as never,
      config,
      fila as never,
    );
    await service.publicarLote();

    expect(fila.enviar).toHaveBeenCalled();
    expect(prisma.mensagemOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({ enviadoEm: expect.any(Date) }),
      }),
    );
  });

  it('incrementa tentativas quando envio à fila falha', async () => {
    const mensagem = {
      id: 'm1',
      eventId: 'e1',
      destino: DESTINO_FILA_OS,
      envelope: {
        eventId: 'e1',
        eventType: 'billing.orcamento-gerado.v1',
        version: 1,
        occurredAt: 't',
        source: 'billing',
        correlationId: 'c',
        causationId: null,
        ordemServicoId: 'os',
        rodada: 1,
        payload: {},
      },
      correlationId: 'c',
    };
    const update = jest.fn();
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: jest
            .fn()
            .mockResolvedValue([{ id: 'm1', destino: DESTINO_FILA_OS }]),
          mensagemOutbox: {
            updateMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([mensagem]),
          },
        }),
      ),
      mensagemOutbox: { update },
    };
    const fila = { enviar: jest.fn().mockRejectedValue(new Error('SQS down')) };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'OUTBOX_PUBLISHER_HABILITADO') return 'true';
        return undefined;
      }),
      getOrThrow: jest.fn().mockReturnValue('https://sqs/os'),
    } as unknown as ConfigService;

    const service = new PublicadorOutboxService(
      prisma as never,
      config,
      fila as never,
    );
    await service.publicarLote();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tentativas: { increment: 1 } }),
      }),
    );
  });

  it('lote vazio não envia', async () => {
    const fila = { enviar: jest.fn() };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          mensagemOutbox: { updateMany: jest.fn(), findMany: jest.fn() },
        }),
      ),
      mensagemOutbox: { update: jest.fn() },
    };
    const config = {
      get: jest.fn().mockReturnValue('true'),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const service = new PublicadorOutboxService(
      prisma as never,
      config,
      fila as never,
    );
    await service.publicarLote();
    expect(fila.enviar).not.toHaveBeenCalled();
  });
});
