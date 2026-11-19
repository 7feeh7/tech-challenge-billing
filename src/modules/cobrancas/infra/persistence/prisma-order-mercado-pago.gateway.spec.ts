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

  describe('order que confirmou o pagamento', () => {
    const linha = (sobrescrever: Record<string, unknown> = {}) => ({
      id: 'omp1',
      cobrancaId: 'c1',
      mercadoPagoOrderId: 'ORD1',
      chaveIdempotencia: 'k1',
      checkoutUrl: 'url',
      statusOrder: null,
      statusDetail: null,
      ativa: true,
      confirmouPagamento: false,
      ...sobrescrever,
    });

    it('busca a order pelo identificador do Mercado Pago', async () => {
      const prisma = {
        orderMercadoPago: {
          findUnique: jest.fn().mockResolvedValue(linha()),
        },
      };
      const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);

      await expect(
        gateway.buscarPorMercadoPagoOrderId('ORD1'),
      ).resolves.toMatchObject({ id: 'omp1', mercadoPagoOrderId: 'ORD1' });
    });

    it('devolve null quando o identificador do Mercado Pago não existe', async () => {
      const prisma = {
        orderMercadoPago: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);

      await expect(
        gateway.buscarPorMercadoPagoOrderId('X'),
      ).resolves.toBeNull();
    });

    it('prefere a order marcada como a que confirmou o pagamento', async () => {
      const prisma = {
        orderMercadoPago: {
          findFirst: jest
            .fn()
            .mockResolvedValue(linha({ confirmouPagamento: true })),
        },
      };
      const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);

      const order = await gateway.buscarQueConfirmouPagamento('c1');

      expect(order?.confirmouPagamento).toBe(true);
      expect(prisma.orderMercadoPago.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.orderMercadoPago.findFirst).toHaveBeenCalledWith({
        where: { cobrancaId: 'c1', confirmouPagamento: true },
      });
    });

    it('sem marca, recai na order ativa', async () => {
      const prisma = {
        orderMercadoPago: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(linha({ id: 'ativa' })),
        },
      };
      const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);

      await expect(
        gateway.buscarQueConfirmouPagamento('c1'),
      ).resolves.toMatchObject({ id: 'ativa' });
    });

    it('sem marca nem order ativa, recai na order mais recente', async () => {
      const prisma = {
        orderMercadoPago: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(linha({ id: 'ultima', ativa: false })),
        },
      };
      const gateway = new PrismaOrderMercadoPagoGateway(prisma as never);

      await expect(
        gateway.buscarQueConfirmouPagamento('c1'),
      ).resolves.toMatchObject({ id: 'ultima' });
    });

    it('marca a order como a que confirmou o pagamento na transação', async () => {
      const clienteTx = { orderMercadoPago: { update: jest.fn() } };
      const gateway = new PrismaOrderMercadoPagoGateway({} as never);

      await gateway.marcarConfirmouPagamento(
        new PrismaContextoTransacao(clienteTx as never),
        'omp1',
      );

      expect(clienteTx.orderMercadoPago.update).toHaveBeenCalledWith({
        where: { id: 'omp1' },
        data: { confirmouPagamento: true },
      });
    });
  });
});
