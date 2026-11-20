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

  it('usa prisma raiz quando contexto não é informado', () => {
    const prisma = { tag: 'root' };
    expect(obterClienteTransacao(undefined, prisma as never)).toBe(prisma);
  });

  it('falha quando contexto tem marca mas não é PrismaContextoTransacao', () => {
    const prisma = { tag: 'root' };
    const contexto = { [ContextoTransacaoMarca]: undefined };

    expect(() => obterClienteTransacao(contexto, prisma as never)).toThrow(
      'Contexto de transação inválido',
    );
  });
});
