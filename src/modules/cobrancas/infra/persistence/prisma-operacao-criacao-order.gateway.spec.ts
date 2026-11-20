import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaOperacaoCriacaoOrderGateway } from './prisma-operacao-criacao-order.gateway';

describe('PrismaOperacaoCriacaoOrderGateway', () => {
  it('obtém operação por cobrança', async () => {
    const prisma = {
      operacaoCriacaoOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'op1',
          cobrancaId: 'c1',
          chaveIdempotencia: 'k1',
          situacao: 'CONCLUIDA',
        }),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };
    const gateway = new PrismaOperacaoCriacaoOrderGateway(prisma as never);
    const op = await gateway.obterPorCobrancaId('c1');
    expect(op?.situacao).toBe('CONCLUIDA');
  });

  it('garante operação em andamento', async () => {
    const clienteTx = {
      operacaoCriacaoOrder: {
        upsert: jest.fn().mockResolvedValue({
          id: 'op1',
          cobrancaId: 'c1',
          chaveIdempotencia: 'k1',
          situacao: 'EM_ANDAMENTO',
        }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma = { operacaoCriacaoOrder: clienteTx.operacaoCriacaoOrder };
    const gateway = new PrismaOperacaoCriacaoOrderGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    const op = await gateway.garantirEmAndamento(contexto, 'c1', 'k1');
    expect(op.chaveIdempotencia).toBe('k1');
  });

  it('marca operação concluída', async () => {
    const clienteTx = {
      operacaoCriacaoOrder: {
        update: jest.fn(),
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const prisma = { operacaoCriacaoOrder: clienteTx.operacaoCriacaoOrder };
    const gateway = new PrismaOperacaoCriacaoOrderGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    await gateway.marcarConcluida(contexto, 'c1');
    expect(clienteTx.operacaoCriacaoOrder.update).toHaveBeenCalled();
  });

  it('reinicia operação com nova chave', async () => {
    const clienteTx = {
      operacaoCriacaoOrder: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: 'op1',
          cobrancaId: 'c1',
          chaveIdempotencia: 'nova-chave',
          situacao: 'EM_ANDAMENTO',
        }),
        upsert: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          chave_idempotencia: 'k-antiga',
          situacao: 'CONCLUIDA',
        },
      ]),
    };
    const prisma = { operacaoCriacaoOrder: clienteTx.operacaoCriacaoOrder };
    const gateway = new PrismaOperacaoCriacaoOrderGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);

    const chave = await gateway.garantirReemissaoEmAndamento(contexto, 'c1');
    expect(chave).toBeDefined();
    expect(clienteTx.operacaoCriacaoOrder.update).toHaveBeenCalled();
  });

  it('reutiliza chave quando reemissão já está em andamento', async () => {
    const clienteTx = {
      operacaoCriacaoOrder: {
        update: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          chave_idempotencia: 'chave-em-andamento',
          situacao: 'EM_ANDAMENTO',
        },
      ]),
    };
    const prisma = { operacaoCriacaoOrder: clienteTx.operacaoCriacaoOrder };
    const gateway = new PrismaOperacaoCriacaoOrderGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    const chave = await gateway.garantirReemissaoEmAndamento(contexto, 'c1');
    expect(chave).toBe('chave-em-andamento');
    expect(clienteTx.operacaoCriacaoOrder.update).not.toHaveBeenCalled();
  });
});
