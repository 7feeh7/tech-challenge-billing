import { ConfigService } from '@nestjs/config';
import { EVENTO_GERAR_ORCAMENTO } from '../../envelope';
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

    const consumidor = new ConsumidorFilaBillingService(
      config,
      fila as never,
      processar as never,
    );
    await consumidor.poller();

    expect(processar.processar).toHaveBeenCalled();
    expect(fila.confirmar).toHaveBeenCalledWith('url', 'rh');
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

    const consumidor = new ConsumidorFilaBillingService(
      config,
      fila as never,
      processar as never,
    );
    await consumidor.poller();

    expect(processar.processar).not.toHaveBeenCalled();
    expect(fila.confirmar).not.toHaveBeenCalled();
  });
});
