import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaAvisoWebhookGateway } from './prisma-aviso-webhook.gateway';

describe('PrismaAvisoWebhookGateway', () => {
  it('registra aviso de webhook na transação', async () => {
    const clienteTx = {
      avisoWebhookMercadoPago: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
    };
    const prisma = { avisoWebhookMercadoPago: clienteTx.avisoWebhookMercadoPago };
    const gateway = new PrismaAvisoWebhookGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    await gateway.registrar(contexto, {
      mercadoPagoOrderId: 'ORD1',
      requestId: 'req',
    });
    expect(clienteTx.avisoWebhookMercadoPago.create).toHaveBeenCalled();
  });
});