import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaTentativaRecusaGateway } from './prisma-tentativa-recusa.gateway';

describe('PrismaTentativaRecusaGateway', () => {
  it('não duplica tentativa de recusa', async () => {
    const clienteTx = {
      tentativaPagamentoRecusada: {
        findUnique: jest.fn().mockResolvedValue({ id: 't1' }),
        create: jest.fn(),
      },
    };
    const prisma = {
      tentativaPagamentoRecusada: clienteTx.tentativaPagamentoRecusada,
    };
    const gateway = new PrismaTentativaRecusaGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);

    const nova = await gateway.registrarSeNova(contexto, {
      cobrancaId: 'c1',
      orderMercadoPagoId: 'omp1',
      paymentIdMercadoPago: 'PAY1',
      motivo: 'insufficient_amount',
    });
    expect(nova).toBe(false);
    expect(clienteTx.tentativaPagamentoRecusada.create).not.toHaveBeenCalled();
  });

  it('registra nova tentativa de recusa', async () => {
    const clienteTx = {
      tentativaPagamentoRecusada: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const prisma = {
      tentativaPagamentoRecusada: clienteTx.tentativaPagamentoRecusada,
    };
    const gateway = new PrismaTentativaRecusaGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    const nova = await gateway.registrarSeNova(contexto, {
      cobrancaId: 'c1',
      orderMercadoPagoId: 'omp1',
      paymentIdMercadoPago: 'PAY1',
      motivo: 'failed',
    });
    expect(nova).toBe(true);
    expect(clienteTx.tentativaPagamentoRecusada.create).toHaveBeenCalled();
  });
});
