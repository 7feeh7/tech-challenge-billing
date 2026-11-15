import { ConfigService } from '@nestjs/config';
import { ConsultarOrderMercadoPagoService } from './consultar-order-mercado-pago.service';

describe('ConsultarOrderMercadoPagoService', () => {
  it('consulta a API quando o token está configurado', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ status: 'processed', status_detail: 'accredited' }),
    });
    global.fetch = fetchMock as typeof fetch;

    const config = {
      get: (chave: string) => {
        if (chave === 'MP_ACCESS_TOKEN') {
          return 'token-teste';
        }
        if (chave === 'MP_API_BASE_URL') {
          return 'https://api.mercadopago.com';
        }
        return '30000';
      },
    } as unknown as ConfigService;
    const servico = new ConsultarOrderMercadoPagoService(config);

    const resultado = await servico.consultar('ORD1');

    expect(resultado.status).toBe('processed');
    expect(resultado.indisponivel).toBe(false);
  });

  it('retorna indisponível quando a API responde erro HTTP', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'not found' }),
    }) as typeof fetch;

    const config = {
      get: (chave: string) => {
        if (chave === 'MP_ACCESS_TOKEN') {
          return 'token-teste';
        }
        if (chave === 'MP_API_BASE_URL') {
          return 'https://api.mercadopago.com';
        }
        if (chave === 'MP_REQUEST_TIMEOUT_MS') {
          return '30000';
        }
        return undefined;
      },
    } as unknown as ConfigService;
    const servico = new ConsultarOrderMercadoPagoService(config);

    const resultado = await servico.consultar('ORD404');

    expect(resultado.indisponivel).toBe(true);
    expect(resultado.motivoIndisponivel).toBe('HTTP 404');
  });

  it('retorna indisponível quando MP_ACCESS_TOKEN não está configurado', async () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const servico = new ConsultarOrderMercadoPagoService(config);

    const resultado = await servico.consultar('ORD1');

    expect(resultado.indisponivel).toBe(true);
    expect(resultado.motivoIndisponivel).toContain('MP_ACCESS_TOKEN');
  });
});
