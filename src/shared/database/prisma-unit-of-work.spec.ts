import { ConfigService } from '@nestjs/config';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

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
      expect(ctx._contextoTransacao).toBe('transacao');
      return 7;
    });

    expect(valor).toBe(7);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});