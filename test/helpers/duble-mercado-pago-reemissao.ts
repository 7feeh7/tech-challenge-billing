import type { MercadoPagoGateway } from '@/modules/cobrancas/application/ports/mercado-pago.gateway';

export interface DubleMercadoPagoReemissao {
  gateway: MercadoPagoGateway;
  ordensCriadasNoDuble: string[];
  ordemPorChave: Map<string, { orderId: string; checkoutUrl: string }>;
  chamadasCriarOrder: Array<{ idempotencyKey: string }>;
}

export function criarDubleMercadoPagoReemissaoSucesso(
  consultaOrderPadrao?: MercadoPagoGateway['consultarOrder'],
): DubleMercadoPagoReemissao {
  const ordemPorChave = new Map<
    string,
    { orderId: string; checkoutUrl: string }
  >();
  const ordensCriadasNoDuble: string[] = [];
  const chamadasCriarOrder: Array<{ idempotencyKey: string }> = [];
  let sequencia = 0;

  const gateway: MercadoPagoGateway = {
    criarOrder: async (input) => {
      chamadasCriarOrder.push({ idempotencyKey: input.idempotencyKey });
      const existente = ordemPorChave.get(input.idempotencyKey);
      if (existente) {
        return {
          tipo: 'sucesso',
          orderId: existente.orderId,
          checkoutUrl: existente.checkoutUrl,
          status: 'action_required',
          statusDetail: 'waiting_for_payment',
        };
      }
      sequencia += 1;
      const orderId = `ORD-REEM-${sequencia}`;
      const checkoutUrl = `https://checkout/${orderId}`;
      ordemPorChave.set(input.idempotencyKey, { orderId, checkoutUrl });
      ordensCriadasNoDuble.push(orderId);
      return {
        tipo: 'sucesso',
        orderId,
        checkoutUrl,
        status: 'action_required',
        statusDetail: 'waiting_for_payment',
      };
    },
    cancelarOrder: async () => ({ tipo: 'sucesso' as const }),
    estornarTotal: async () => ({ tipo: 'sucesso' as const }),
    consultarOrder:
      consultaOrderPadrao ??
      (async () => ({
        tipo: 'sucesso',
        order: {
          id: 'ORD-PREV',
          status: 'canceled',
          statusDetail: 'expired',
          pagamentos: [],
        },
      })),
  };

  return { gateway, ordensCriadasNoDuble, ordemPorChave, chamadasCriarOrder };
}

/**
 * Duble compartilhado: cria order no "MP" e perde a resposta (timeout)
 * na primeira chamada por chave; retentativas com a mesma chave devolvem sucesso idempotente.
 */
export function criarDubleMercadoPagoReemissao(
  consultaOrderPadrao: MercadoPagoGateway['consultarOrder'] = async () => ({
    tipo: 'sucesso',
    order: {
      id: 'ORD-PREV',
      status: 'canceled',
      statusDetail: 'expired',
      pagamentos: [],
    },
  }),
): DubleMercadoPagoReemissao {
  const ordemPorChave = new Map<
    string,
    { orderId: string; checkoutUrl: string }
  >();
  const ordensCriadasNoDuble: string[] = [];
  const chamadasCriarOrder: Array<{ idempotencyKey: string }> = [];
  let sequencia = 0;

  const gateway: MercadoPagoGateway = {
    criarOrder: async (input) => {
      chamadasCriarOrder.push({ idempotencyKey: input.idempotencyKey });
      const existente = ordemPorChave.get(input.idempotencyKey);
      if (existente) {
        return {
          tipo: 'sucesso',
          orderId: existente.orderId,
          checkoutUrl: existente.checkoutUrl,
          status: 'action_required',
          statusDetail: 'waiting_for_payment',
        };
      }

      sequencia += 1;
      const orderId = `ORD-REEM-${sequencia}`;
      const checkoutUrl = `https://checkout/${orderId}`;
      ordemPorChave.set(input.idempotencyKey, { orderId, checkoutUrl });
      ordensCriadasNoDuble.push(orderId);

      return {
        tipo: 'indeterminado',
        motivo: 'TimeoutError: order criada no MP sem resposta ao cliente',
      };
    },
    cancelarOrder: async () => ({ tipo: 'sucesso' as const }),
    estornarTotal: async () => ({ tipo: 'sucesso' as const }),
    consultarOrder: consultaOrderPadrao,
  };

  return { gateway, ordensCriadasNoDuble, ordemPorChave, chamadasCriarOrder };
}