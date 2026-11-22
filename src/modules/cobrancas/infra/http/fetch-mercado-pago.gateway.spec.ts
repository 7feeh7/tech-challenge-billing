import { Logger } from '@nestjs/common';
import { FetchMercadoPagoGateway } from './fetch-mercado-pago.gateway';

// GET real da Orders API (sandbox, E05), sem
// campos sensíveis: o pagamento aprovado vem processed/accredited, sem date_approved.
const ORDER_PROCESSED_REAL = {
  id: 'ORDTST01M7GMMTFB6C17A37RM207XAST',
  type: 'online',
  processing_mode: 'manual',
  total_amount: '212.00',
  total_paid_amount: '212.00',
  expiration_time: 'PT30M',
  status: 'processed',
  status_detail: 'accredited',
  currency: 'BRL',
  created_date: '2026-11-15T22:18:32.827Z',
  last_updated_date: '2026-11-15T22:28:46.556Z',
  transactions: {
    payments: [
      {
        id: 'PAY01M7GN4JNQ27FGP9YTXRP9TCG6',
        amount: '212',
        status: 'failed',
        status_detail: 'insufficient_amount',
        attempt_number: 1,
      },
      {
        id: 'PAY01M7GN7HTVMPN47J1BW52QB7B7',
        amount: '212',
        paid_amount: '212',
        status: 'processed',
        status_detail: 'accredited',
        attempt_number: 2,
      },
    ],
  },
};

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

  it('mapeia order processed real sem date_approved usando created_date da order', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(ORDER_PROCESSED_REAL),
    } as Response);

    const resultado = await gateway.consultarOrder(
      'ORDTST01M7GMMTFB6C17A37RM207XAST',
    );

    expect(resultado.tipo).toBe('sucesso');
    if (resultado.tipo !== 'sucesso') return;
    expect(resultado.order.status).toBe('processed');
    expect(resultado.order.createdDate).toBe('2026-11-15T22:18:32.827Z');
    expect(resultado.order.pagamentos).toEqual([
      {
        id: 'PAY01M7GN4JNQ27FGP9YTXRP9TCG6',
        status: 'failed',
        statusDetail: 'insufficient_amount',
        dateApproved: undefined,
      },
      {
        id: 'PAY01M7GN7HTVMPN47J1BW52QB7B7',
        status: 'processed',
        statusDetail: 'accredited',
        dateApproved: undefined,
      },
    ]);
  });

  it('mapeia order sem created_date com createdDate indefinido', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'ORD1', status: 'created' }),
    } as Response);

    const resultado = await gateway.consultarOrder('ORD1');

    expect(resultado.tipo).toBe('sucesso');
    if (resultado.tipo === 'sucesso') {
      expect(resultado.order.createdDate).toBeUndefined();
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

  it('cancelar order com 409 cannot_cancel_order vira conflito_especifico', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          errors: [{ code: 'cannot_cancel_order' }],
        }),
    } as Response);
    const resultado = await gateway.cancelarOrder('ORD1', 'k1');
    expect(resultado.tipo).toBe('conflito_especifico');
  });

  it('estorno total com sucesso', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({ status: 'refunded', refunded_amount: 100 }),
    } as Response);
    const resultado = await gateway.estornarTotal('ORD1', 'k1');
    expect(resultado.tipo).toBe('sucesso');
  });

  it('estorno 409 genérico fica indeterminado', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ message: 'Conflict' }),
    } as Response);
    const resultado = await gateway.estornarTotal('ORD1', 'k1');
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('cancelar order com 409 refund_in_progress é conflito específico', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          errors: [{ code: 'refund_in_progress' }],
        }),
    } as Response);
    const resultado = await gateway.cancelarOrder('ORD1', 'k1');
    expect(resultado).toEqual({
      tipo: 'conflito_especifico',
      codigo: 'refund_in_progress',
    });
  });

  it('estorno com 428 insufficient_money_for_refund é indeterminado de negócio', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 428,
      text: async () => '{"message":"insufficient_money_for_refund"}',
    } as Response);
    const resultado = await gateway.estornarTotal('ORD1', 'k1');
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('cancelar sem token retorna indeterminado', async () => {
    const gateway = new FetchMercadoPagoGateway({
      get: () => undefined,
    } as never);
    const resultado = await gateway.cancelarOrder('ORD1', 'k1');
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('estorno com sucesso mapeia refunded_amount em centavos na consulta', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: 'ORD1',
          status: 'refunded',
          refunded_amount: 99.5,
          transactions: { payments: [] },
        }),
    } as Response);
    const resultado = await gateway.consultarOrder('ORD1');
    expect(resultado.tipo).toBe('sucesso');
    if (resultado.tipo === 'sucesso') {
      expect(resultado.order.refundedAmount).toBe(9950);
    }
  });

  it('consulta order sem token é indeterminado', async () => {
    const gateway = new FetchMercadoPagoGateway({
      get: () => undefined,
    } as never);
    const resultado = await gateway.consultarOrder('ORD1');
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('consulta order com erro de rede', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const resultado = await gateway.consultarOrder('ORD1');
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('cancelar order com 5xx é indeterminado técnico', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '{}',
    } as Response);
    const resultado = await gateway.cancelarOrder('ORD1', 'k1');
    expect(resultado.tipo).toBe('indeterminado');
  });

  it('estorno 409 order_already_refunded é conflito específico', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          errors: [{ code: 'order_already_refunded' }],
        }),
    } as Response);
    const resultado = await gateway.estornarTotal('ORD1', 'k1');
    expect(resultado).toEqual({
      tipo: 'conflito_especifico',
      codigo: 'order_already_refunded',
    });
  });

  it('409 com status_detail no corpo', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          status_detail: 'order_already_refunded',
        }),
    } as Response);
    const resultado = await gateway.estornarTotal('ORD1', 'k1');
    expect(resultado.tipo).toBe('conflito_especifico');
  });

  it('refunded_amount string na consulta', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: 'ORD1',
          status: 'refunded',
          refunded_amount: '12.34',
          transactions: { payments: [] },
        }),
    } as Response);
    const resultado = await gateway.consultarOrder('ORD1');
    if (resultado.tipo === 'sucesso') {
      expect(resultado.order.refundedAmount).toBe(1234);
    }
  });

  it('409 com código em message no array errors', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          errors: [{ message: 'cannot_cancel_order' }],
        }),
    } as Response);
    const resultado = await gateway.cancelarOrder('ORD1', 'k1');
    expect(resultado.tipo).toBe('conflito_especifico');
  });

  it('estorno 5xx indeterminado', async () => {
    const gateway = new FetchMercadoPagoGateway(config as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{}',
    } as Response);
    const resultado = await gateway.estornarTotal('ORD1', 'k1');
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

  describe('sinal billing.mercado_pago.falha_tecnica', () => {
    const inputCriarOrder = {
      externalReference: 'c1',
      totalAmount: '10.00',
      expirationTime: 'PT15M',
      idempotencyKey: 'k1',
      payerEmail: 'a@b.com',
    };

    const operacoes = [
      {
        operacao: 'criar_order',
        executar: (gateway: FetchMercadoPagoGateway) =>
          gateway.criarOrder(inputCriarOrder),
      },
      {
        operacao: 'consultar_order',
        executar: (gateway: FetchMercadoPagoGateway) =>
          gateway.consultarOrder('ORD1'),
      },
      {
        operacao: 'cancelar_order',
        executar: (gateway: FetchMercadoPagoGateway) =>
          gateway.cancelarOrder('ORD1', 'k1'),
      },
      {
        operacao: 'estornar_total',
        executar: (gateway: FetchMercadoPagoGateway) =>
          gateway.estornarTotal('ORD1', 'k1'),
      },
    ];

    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    function sinaisEmitidos(): unknown[] {
      return warn.mock.calls.map(([mensagem]) => JSON.parse(mensagem));
    }

    function responder(status: number, corpo = '{}'): void {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: async () => corpo,
      } as Response);
    }

    it.each(operacoes)(
      '$operacao: emite um sinal http_5xx com o status HTTP',
      async ({ operacao, executar }) => {
        responder(503);

        const resultado = await executar(
          new FetchMercadoPagoGateway(config as never),
        );

        expect(resultado.tipo).toBe('indeterminado');
        expect(sinaisEmitidos()).toEqual([
          {
            metric: 'billing.mercado_pago.falha_tecnica',
            operacao,
            motivo: 'http_5xx',
            statusHttp: 503,
          },
        ]);
      },
    );

    it.each(operacoes)(
      '$operacao: emite um sinal timeout quando o fetch estoura o tempo',
      async ({ operacao, executar }) => {
        jest
          .spyOn(global, 'fetch')
          .mockRejectedValue(
            new DOMException('The operation timed out.', 'TimeoutError'),
          );

        await executar(new FetchMercadoPagoGateway(config as never));

        expect(sinaisEmitidos()).toEqual([
          {
            metric: 'billing.mercado_pago.falha_tecnica',
            operacao,
            motivo: 'timeout',
          },
        ]);
      },
    );

    it.each(operacoes)(
      '$operacao: emite um sinal rede em erro de conexão',
      async ({ operacao, executar }) => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));

        await executar(new FetchMercadoPagoGateway(config as never));

        expect(sinaisEmitidos()).toEqual([
          {
            metric: 'billing.mercado_pago.falha_tecnica',
            operacao,
            motivo: 'rede',
          },
        ]);
      },
    );

    it.each(operacoes)(
      '$operacao: emite um sinal token_ausente sem chamar o Mercado Pago',
      async ({ operacao, executar }) => {
        const fetchSpy = jest.spyOn(global, 'fetch');

        await executar(
          new FetchMercadoPagoGateway({ get: () => undefined } as never),
        );

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(sinaisEmitidos()).toEqual([
          {
            metric: 'billing.mercado_pago.falha_tecnica',
            operacao,
            motivo: 'token_ausente',
          },
        ]);
      },
    );

    it('trata HTTP 408 como timeout com o status HTTP', async () => {
      responder(408);

      await new FetchMercadoPagoGateway(config as never).cancelarOrder(
        'ORD1',
        'k1',
      );

      expect(sinaisEmitidos()).toEqual([
        {
          metric: 'billing.mercado_pago.falha_tecnica',
          operacao: 'cancelar_order',
          motivo: 'timeout',
          statusHttp: 408,
        },
      ]);
    });

    it('emite resposta_invalida quando a criação não traz order id e checkout_url', async () => {
      responder(201, JSON.stringify({ id: 'ORD-NEW' }));

      await new FetchMercadoPagoGateway(config as never).criarOrder(
        inputCriarOrder,
      );

      expect(sinaisEmitidos()).toEqual([
        {
          metric: 'billing.mercado_pago.falha_tecnica',
          operacao: 'criar_order',
          motivo: 'resposta_invalida',
        },
      ]);
    });

    it('não expõe corpo da resposta, token, pagador nem identificadores', async () => {
      responder(500, '{"message":"segredo-no-corpo"}');

      await new FetchMercadoPagoGateway(config as never).criarOrder(
        inputCriarOrder,
      );

      const mensagem = warn.mock.calls[0][0] as string;
      expect(mensagem).not.toContain('segredo-no-corpo');
      expect(mensagem).not.toContain('token-teste');
      expect(mensagem).not.toContain('a@b.com');
      expect(mensagem).not.toContain('c1');
      expect(mensagem).not.toContain('10.00');
    });

    it('emite um sinal por chamada HTTP com falha, inclusive em retentativas', async () => {
      responder(502);
      const gateway = new FetchMercadoPagoGateway(config as never);

      await gateway.consultarOrder('ORD1');
      await gateway.consultarOrder('ORD1');

      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('não emite sinal em sucesso', async () => {
      const gateway = new FetchMercadoPagoGateway(config as never);

      responder(201, JSON.stringify({ id: 'ORD', checkout_url: 'https://c' }));
      await gateway.criarOrder(inputCriarOrder);
      responder(200, JSON.stringify({ id: 'ORD1', status: 'processed' }));
      await gateway.consultarOrder('ORD1');
      responder(200, JSON.stringify({ status: 'canceled' }));
      await gateway.cancelarOrder('ORD1', 'k1');
      responder(201, JSON.stringify({ status: 'refunded' }));
      await gateway.estornarTotal('ORD1', 'k1');

      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      [
        'criarOrder 400',
        400,
        (g: FetchMercadoPagoGateway) => g.criarOrder(inputCriarOrder),
      ],
      [
        'cancelarOrder 422',
        422,
        (g: FetchMercadoPagoGateway) => g.cancelarOrder('ORD1', 'k1'),
      ],
      [
        'estornarTotal 428',
        428,
        (g: FetchMercadoPagoGateway) => g.estornarTotal('ORD1', 'k1'),
      ],
      [
        'consultarOrder 404',
        404,
        (g: FetchMercadoPagoGateway) => g.consultarOrder('ORD1'),
      ],
      [
        'cancelarOrder 409 genérico',
        409,
        (g: FetchMercadoPagoGateway) => g.cancelarOrder('ORD1', 'k1'),
      ],
    ])(
      'não emite sinal em resultado de negócio: %s',
      async (_nome, status, executar) => {
        responder(status, '{"message":"Conflict"}');

        await executar(new FetchMercadoPagoGateway(config as never));

        expect(warn).not.toHaveBeenCalled();
      },
    );

    it('não emite sinal em conflito específico de negócio', async () => {
      responder(
        409,
        JSON.stringify({ errors: [{ code: 'cannot_cancel_order' }] }),
      );

      const resultado = await new FetchMercadoPagoGateway(
        config as never,
      ).cancelarOrder('ORD1', 'k1');

      expect(resultado.tipo).toBe('conflito_especifico');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
