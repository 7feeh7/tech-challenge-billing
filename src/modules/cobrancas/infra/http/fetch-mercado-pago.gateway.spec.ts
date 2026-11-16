import { FetchMercadoPagoGateway } from './fetch-mercado-pago.gateway';

describe('FetchMercadoPagoGateway', () => {
  const config = {
    get: (chave: string) => {
      if (chave === 'MP_ACCESS_TOKEN') return 'token-teste';
      if (chave === 'MP_REQUEST_TIMEOUT_MS') return '5000';
      return undefined;
    },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retorna indeterminado sem token', async () => {
    const gateway = new FetchMercadoPagoGateway({
      get: () => undefined,
    } as never);
    const resultado = await gateway.criarOrder({
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    });
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('mapeia order consultada com pagamentos', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
          transactions: {
            payments: [
              {
                id: 'PAY1',
                status: 'accredited',
                date_approved: '2026-11-15T00:00:00.000Z',
              },
            ],
          },
        }),
    } as Response);

    const resultado = await gateway.consultarOrder('ORD1');
    expect(resultado.tipo).toBe('sucesso');
    if (resultado.tipo === 'sucesso') {
      expect(resultado.order.pagamentos[0]?.id).toBe('PAY1');
    }
  });

  it('rejeita resposta de criação sem checkout_url', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 'ORD-NEW' }),
    } as Response);
    const resultado = await gateway.criarOrder({
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    });
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('trata corpo inválido na criação', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => 'nao-json',
    } as Response);
    const resultado = await gateway.criarOrder({
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    });
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('trata 5xx na criação como indeterminado técnico', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '{}',
    } as Response);
    const resultado = await gateway.criarOrder({
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    });
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('cria order com sucesso', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          id: 'ORD-NEW',
          checkout_url: 'https://checkout/new',
          status: 'action_required',
        }),
    } as Response);

    const resultado = await gateway.criarOrder({
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    });
    expect(resultado.tipo).toBe('sucesso');
  });

  it('trata 5xx na consulta como indeterminado', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '{}',
    } as Response);
    const resultado = await gateway.consultarOrder('ORD1');
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('trata resposta JSON inválida na consulta', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'nao-json',
    } as Response);
    const resultado = await gateway.consultarOrder('ORD1');
    expect(resultado.tipo).toBe('sucesso');
    if (resultado.tipo === 'sucesso') {
      expect(resultado.order.pagamentos).toHaveLength(0);
    }
  });

  it('trata 4xx na criação como indeterminado de negócio', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"bad_request"}',
    } as Response);
    const resultado = await gateway.criarOrder({
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    });
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('trata timeout na criação como indeterminado', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('TimeoutError: signal timed out'));

    const resultado = await gateway.criarOrder({
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    });
    expect(resultado.tipo).toBe('indeterminado');
  });
});