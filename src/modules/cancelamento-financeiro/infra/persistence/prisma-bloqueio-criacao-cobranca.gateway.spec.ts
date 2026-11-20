import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaBloqueioCriacaoCobrancaGateway } from './prisma-bloqueio-criacao-cobranca.gateway';

describe('PrismaBloqueioCriacaoCobrancaGateway', () => {
  it('existe retorna false sem registro', async () => {
    const prisma = {
      bloqueioCriacaoCobranca: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const gateway = new PrismaBloqueioCriacaoCobrancaGateway(prisma as never);
    await expect(gateway.existe('os1', 1)).resolves.toBe(false);
  });

  it('existe retorna true com registro', async () => {
    const prisma = {
      bloqueioCriacaoCobranca: {
        findUnique: jest.fn().mockResolvedValue({ id: 'b1' }),
      },
    };
    const gateway = new PrismaBloqueioCriacaoCobrancaGateway(prisma as never);
    await expect(gateway.existe('os1', 1)).resolves.toBe(true);
  });

  it('garantir faz upsert na transação', async () => {
    const upsert = jest.fn();
    const clienteTx = { bloqueioCriacaoCobranca: { upsert } };
    const gateway = new PrismaBloqueioCriacaoCobrancaGateway({
      bloqueioCriacaoCobranca: {},
    } as never);
    const ctx = new PrismaContextoTransacao(clienteTx as never);
    await gateway.garantir(ctx, 'os1', 2, 'cancelamento');
    expect(upsert).toHaveBeenCalled();
  });

  it('garantir aceita motivo omitido', async () => {
    const upsert = jest.fn();
    const gateway = new PrismaBloqueioCriacaoCobrancaGateway({
      bloqueioCriacaoCobranca: {},
    } as never);
    const ctx = new PrismaContextoTransacao({
      bloqueioCriacaoCobranca: { upsert },
    } as never);
    await gateway.garantir(ctx, 'os1', 1, null);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ motivo: null }),
      }),
    );
  });
});
