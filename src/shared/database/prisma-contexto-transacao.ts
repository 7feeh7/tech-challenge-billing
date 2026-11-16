import type { Prisma } from '../generated/prisma/client';
import type { ContextoTransacao } from './unit-of-work.port';

export class PrismaContextoTransacao implements ContextoTransacao {
  readonly _contextoTransacao = 'transacao' as const;

  constructor(readonly cliente: Prisma.TransactionClient) {}
}