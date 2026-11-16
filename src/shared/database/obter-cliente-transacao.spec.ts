import { obterClienteTransacao } from './obter-cliente-transacao';
import { PrismaContextoTransacao } from './prisma-contexto-transacao';
import { ContextoTransacaoMarca } from './unit-of-work.port';

describe('obterClienteTransacao', () => {
  it('usa cliente da transação quando contexto é PrismaContextoTransacao', () => {
    const tx = { tag: 'tx' };
    const contexto = new PrismaContextoTransacao(tx as never);
    const prisma = { tag: 'root' };

    expect(obterClienteTransacao(contexto, prisma as never)).toBe(tx);
  });

  it('usa prisma raiz quando contexto é falso de teste', () => {
    const prisma = { tag: 'root' };
    const contexto = { [ContextoTransacaoMarca]: undefined };

    expect(obterClienteTransacao(contexto, prisma as never)).toBe(prisma);
  });
});
