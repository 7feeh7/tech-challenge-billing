import { ConfigService } from '@nestjs/config';
import { FetchReservaOsGateway } from './fetch-reserva-os.gateway';

describe('FetchReservaOsGateway', () => {
  const pedido = {
    ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
    rodada: 1,
    orcamentoId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    tentativaAprovacao: 1,
    correlationId: '550e8400-e29b-41d4-a716-446655440001',
    requestId: '550e8400-e29b-41d4-a716-446655440002',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reutiliza a mesma Idempotency-Key em novas tentativas de rede', async () => {
    const chaves: string[] = [];
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            reservaId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
            prazoReferencia: '2026-11-15T12:05:00.000Z',
          }),
      }) as never;

    const gateway = new FetchReservaOsGateway({
      get: (k: string) =>
        ({
          OS_SERVICE_BASE_URL: 'http://os.test',
          OS_SERVICE_TOKEN: 'token',
          OS_REQUEST_TIMEOUT_MS: '50',
          OS_REQUEST_MAX_TENTATIVAS: '3',
        })[k],
    } as ConfigService);

    const resultado = await gateway.reservar(pedido);
    expect(resultado.tipo).toBe('sucesso');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    for (const chamada of (global.fetch as jest.Mock).mock.calls) {
      const headers = chamada[1].headers as Record<string, string>;
      chaves.push(headers['Idempotency-Key']);
    }
    expect(new Set(chaves).size).toBe(1);
    expect(chaves[0]).toBe('reserva:6ba7b810-9dad-11d1-80b4-00c04fd430c8:1');
  });

  it('trata timeout como indeterminado após esgotar tentativas', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as never;
    const gateway = new FetchReservaOsGateway({
      get: (k: string) =>
        ({
          OS_REQUEST_MAX_TENTATIVAS: '2',
          OS_REQUEST_TIMEOUT_MS: '10',
        })[k],
    } as ConfigService);

    const resultado = await gateway.reservar(pedido);
    expect(resultado.tipo).toBe('indeterminado');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('retorna indeterminado em 500 após tentativas', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'erro',
    }) as never;
    const gateway = new FetchReservaOsGateway({
      get: (k: string) =>
        ({ OS_REQUEST_MAX_TENTATIVAS: '2', OS_REQUEST_TIMEOUT_MS: '10' })[k],
    } as ConfigService);
    const resultado = await gateway.reservar(pedido);
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('trata 200 sem JSON válido como indeterminado', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'texto',
    }) as never;
    const gateway = new FetchReservaOsGateway({
      get: () => undefined,
    } as never);
    expect((await gateway.reservar(pedido)).tipo).toBe('indeterminado');
  });

  it('trata 200 sem reservaId como indeterminado', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ prazoReferencia: '2026-11-15T12:00:00.000Z' }),
    }) as never;
    const gateway = new FetchReservaOsGateway({
      get: () => undefined,
    } as never);
    expect((await gateway.reservar(pedido)).tipo).toBe('indeterminado');
  });

  it('trata 409 sem código reconhecido', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ codigo: 'OUTRO', mensagem: 'x' }),
    }) as never;
    const gateway = new FetchReservaOsGateway({
      get: () => undefined,
    } as never);
    expect((await gateway.reservar(pedido)).motivo).toContain('409 sem código');
  });

  it('trata HTTP inesperado', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 418,
      text: async () => '{}',
    }) as never;
    const gateway = new FetchReservaOsGateway({
      get: () => undefined,
    } as never);
    expect((await gateway.reservar(pedido)).motivo).toContain('418');
  });

  it('interpreta todos os códigos 409 previstos', async () => {
    for (const codigo of [
      'ESTOQUE_INSUFICIENTE',
      'RODADA_OBSOLETA',
      'OS_EM_CANCELAMENTO',
      'CONTEUDO_DIVERGENTE',
    ]) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ codigo, mensagem: codigo }),
      }) as never;
      const gateway = new FetchReservaOsGateway({
        get: () => undefined,
      } as never);
      const resultado = await gateway.reservar(pedido);
      expect(resultado).toEqual({
        tipo: 'conflito',
        codigo,
        mensagem: codigo,
      });
    }
  });

  it('interpreta 409 ESTADO_INCOMPATIVEL', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          codigo: 'ESTADO_INCOMPATIVEL',
          mensagem: 'status atual',
        }),
    }) as never;

    const gateway = new FetchReservaOsGateway({
      get: () => undefined,
    } as never);
    const resultado = await gateway.reservar(pedido);
    expect(resultado).toEqual({
      tipo: 'conflito',
      codigo: 'ESTADO_INCOMPATIVEL',
      mensagem: 'status atual',
    });
  });
});
