import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaOrderMercadoPagoGateway } from './prisma-order-mercado-pago.gateway';

describe('PrismaOrderMercadoPagoGateway', () => {
  it('retorna order ativa por cobrança', async () => {
    const prisma = {
      orderMercadoPago: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);
    await expect(gateway.buscarAtivaPorCobrancaId('c1')).resolves.toBeNull();
  });

  it('cria registro da order na transação', async () => {
    const clienteTx = {
      orderMercadoPago: {
        create: jest.fn().mockResolvedValue({
          id: 'omp1',
          cobrancaId: 'c1',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'k1',
          checkoutUrl: 'url',
          statusOrder: null,
          statusDetail: null,
          ativa: true,
        }),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma = { orderMercadoPago: clienteTx.orderMercadoPago };
    const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);

    const registro = await gateway.criar(contexto, {
      cobrancaId: 'c1',
      mercadoPagoOrderId: 'ORD1',
      chaveIdempotencia: 'k1',
      checkoutUrl: 'url',
      ativa: true,
    });
    expect(registro.mercadoPagoOrderId).toBe('ORD1');
  });

  it('atualiza situação e desativa order', async () => {
    const clienteTx = {
      orderMercadoPago: {
        update: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = { orderMercadoPago: clienteTx.orderMercadoPago };
    const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    await gateway.atualizarSituacao(
      contexto,
      'omp1',
      'processed',
      'accredited',
    );
    await gateway.desativar(contexto, 'omp1');
    expect(clienteTx.orderMercadoPago.update).toHaveBeenCalledTimes(2);
  });
});
