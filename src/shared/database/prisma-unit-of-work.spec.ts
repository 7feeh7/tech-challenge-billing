import { ConfigService } from '@nestjs/config';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { ContextoTransacaoMarca } from './unit-of-work.port';

describe('PrismaUnitOfWork', () => {
  it('executa trabalho dentro de $transaction', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<number>) =>
        fn({}),
      ),
    };
    const config = {
      get: jest.fn().mockReturnValue('10000'),
    } as unknown as ConfigService;
    const uow = new PrismaUnitOfWork(prisma as never, config);

    const valor = await uow.executar(async (ctx) => {
      expect(ctx[ContextoTransacaoMarca]).toBeUndefined();
      return 7;
    });

    expect(valor).toBe(7);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
