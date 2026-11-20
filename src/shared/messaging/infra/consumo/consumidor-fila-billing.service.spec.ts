import { ConfigService } from '@nestjs/config';
import {
  EVENTO_CANCELAR_FINANCEIRO,
  EVENTO_CONSULTAR_SITUACAO_FINANCEIRA,
  EVENTO_GERAR_ORCAMENTO,
} from '../../envelope';
import { ConsumidorFilaBillingService } from './consumidor-fila-billing.service';

describe('ConsumidorFilaBillingService', () => {
  it('confirma mensagem após processar GerarOrcamento', async () => {
    const processar = { processar: jest.fn().mockResolvedValue(undefined) };
    const fila = {
      receber: jest.fn().mockResolvedValue([
        {
          corpo: JSON.stringify({
            eventId: '550e8400-e29b-41d4-a716-446655440099',
            eventType: EVENTO_GERAR_ORCAMENTO,
            version: 1,
            occurredAt: '2026-11-15T10:00:00.000Z',
            source: 'os-service',
            correlationId: '550e8400-e29b-41d4-a716-446655440000',
            causationId: null,
            ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
            rodada: 1,
            payload: {
              clienteId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
              itens: [],
            },
          }),
          receiptHandle: 'rh',
        },
      ]),
      confirmar: jest.fn(),
      enviar: jest.fn(),
    };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_BILLING_IN_URL') return 'url';
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        return undefined;
      }),
    } as unknown as ConfigService;

    const cancelarFinanceiro = { processar: jest.fn() };
    const consumidor = new ConsumidorFilaBillingService(
      config,
      fila as never,
      processar as never,
      cancelarFinanceiro as never,
      { processar: jest.fn() } as never,
    );
    await consumidor.poller();

    expect(processar.processar).toHaveBeenCalled();
    expect(fila.confirmar).toHaveBeenCalledWith('url', 'rh');
  });

  it('encaminha billing.cancelar-financeiro.v1', async () => {
    const cancelarFinanceiro = {
      processar: jest.fn().mockResolvedValue(undefined),
    };
    const fila = {
      receber: jest.fn().mockResolvedValue([
        {
          corpo: JSON.stringify({
            eventId: '550e8400-e29b-41d4-a716-446655440099',
            eventType: EVENTO_CANCELAR_FINANCEIRO,
            version: 1,
            occurredAt: '2026-11-15T10:00:00.000Z',
            source: 'os-service',
            correlationId: '550e8400-e29b-41d4-a716-446655440000',
            causationId: null,
            ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
            rodada: 1,
            payload: {
              etapaOrigem: 'CANCELAMENTO_OS',
              motivo: 'teste',
              resultadoExecucao: 'REPARO_NAO_INICIADO',
            },
          }),
          receiptHandle: 'rh2',
        },
      ]),
      confirmar: jest.fn(),
      enviar: jest.fn(),
    };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_BILLING_IN_URL') return 'url';
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        return undefined;
      }),
    } as unknown as ConfigService;

    const consumidor = new ConsumidorFilaBillingService(
      config,
      fila as never,
      { processar: jest.fn() } as never,
      cancelarFinanceiro as never,
      { processar: jest.fn() } as never,
    );
    await consumidor.poller();
    expect(cancelarFinanceiro.processar).toHaveBeenCalled();
    expect(fila.confirmar).toHaveBeenCalledWith('url', 'rh2');
  });

  it('encaminha billing.consultar-situacao-financeira.v1', async () => {
    const consultar = { processar: jest.fn().mockResolvedValue(undefined) };
    const fila = {
      receber: jest.fn().mockResolvedValue([
        {
          corpo: JSON.stringify({
            eventId: '550e8400-e29b-41d4-a716-446655440099',
            eventType: EVENTO_CONSULTAR_SITUACAO_FINANCEIRA,
            version: 1,
            occurredAt: '2026-11-16T12:00:00.000Z',
            source: 'os-service',
            correlationId: '550e8400-e29b-41d4-a716-446655440000',
            causationId: null,
            ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
            rodada: 1,
            payload: {
              consultaId: 'f7e1d5c4-9a6b-7c2d-1e4f-5a8b0c3d6e9f',
              finalidade: 'PRAZO_DE_REFERENCIA_VENCIDO',
            },
          }),
          receiptHandle: 'rh-consulta',
        },
      ]),
      confirmar: jest.fn(),
    };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_BILLING_IN_URL') return 'url';
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        return undefined;
      }),
    } as unknown as ConfigService;
    const consumidor = new ConsumidorFilaBillingService(
      config,
      fila as never,
      { processar: jest.fn() } as never,
      { processar: jest.fn() } as never,
      consultar as never,
    );
    await consumidor.poller();
    expect(consultar.processar).toHaveBeenCalled();
    expect(fila.confirmar).toHaveBeenCalledWith('url', 'rh-consulta');
  });

  it('não confirma mensagem com envelope inválido', async () => {
    const processar = { processar: jest.fn() };
    const fila = {
      receber: jest
        .fn()
        .mockResolvedValue([
          { corpo: JSON.stringify({ eventType: 'x' }), receiptHandle: 'rh' },
        ]),
      confirmar: jest.fn(),
      enviar: jest.fn(),
    };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_BILLING_IN_URL') return 'url';
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        return undefined;
      }),
    } as unknown as ConfigService;

    const cancelarFinanceiro = { processar: jest.fn() };
    const consumidor = new ConsumidorFilaBillingService(
      config,
      fila as never,
      processar as never,
      cancelarFinanceiro as never,
      { processar: jest.fn() } as never,
    );
    await consumidor.poller();

    expect(processar.processar).not.toHaveBeenCalled();
    expect(fila.confirmar).not.toHaveBeenCalled();
  });

  it('onModuleDestroy limpa intervalo', () => {
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_BILLING_IN_URL') return 'url';
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        if (k === 'SQS_CONSUMER_INTERVAL_MS') return '60000';
        return undefined;
      }),
    } as unknown as ConfigService;
    const consumidor = new ConsumidorFilaBillingService(
      config,
      { receber: jest.fn() } as never,
      { processar: jest.fn() } as never,
      { processar: jest.fn() } as never,
      { processar: jest.fn() } as never,
    );
    const clearSpy = jest.spyOn(global, 'clearInterval');
    consumidor.onModuleInit();
    expect((consumidor as { intervalo?: unknown }).intervalo).toBeDefined();
    consumidor.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('não inicia polling quando consumidor desabilitado', () => {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const consumidor = new ConsumidorFilaBillingService(
      config,
      { receber: jest.fn() } as never,
      { processar: jest.fn() } as never,
      { processar: jest.fn() } as never,
      { processar: jest.fn() } as never,
    );
    consumidor.onModuleInit();
    expect((consumidor as { intervalo?: unknown }).intervalo).toBeUndefined();
  });

  it('confirma envelope válido de tipo desconhecido sem processador', async () => {
    const fila = {
      receber: jest.fn().mockResolvedValue([
        {
          corpo: JSON.stringify({
            eventId: '550e8400-e29b-41d4-a716-446655440099',
            eventType: 'billing.desconhecido.v1',
            version: 1,
            occurredAt: '2026-11-15T10:00:00.000Z',
            source: 'x',
            correlationId: '550e8400-e29b-41d4-a716-446655440000',
            causationId: null,
            ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
            rodada: 1,
            payload: {},
          }),
          receiptHandle: 'rh3',
        },
      ]),
      confirmar: jest.fn(),
    };
    const config = {
      get: jest.fn((k: string) => {
        if (k === 'SQS_BILLING_IN_URL') return 'url';
        if (k === 'SQS_CONSUMER_HABILITADO') return 'true';
        return undefined;
      }),
    } as unknown as ConfigService;
    const gerar = { processar: jest.fn() };
    const cancelar = { processar: jest.fn() };
    const consumidor = new ConsumidorFilaBillingService(
      config,
      fila as never,
      gerar as never,
      cancelar as never,
      { processar: jest.fn() } as never,
    );
    await consumidor.poller();
    expect(gerar.processar).not.toHaveBeenCalled();
    expect(cancelar.processar).not.toHaveBeenCalled();
    expect(fila.confirmar).toHaveBeenCalledWith('url', 'rh3');
  });
});
