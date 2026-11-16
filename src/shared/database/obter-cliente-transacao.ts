import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from './prisma.service';
import { PrismaContextoTransacao } from './prisma-contexto-transacao';
import type { ContextoTransacao } from './unit-of-work.port';

export function obterClienteTransacao(
  contexto: ContextoTransacao,
  prisma: PrismaService,
): Prisma.TransactionClient | PrismaService {
  if (contexto instanceof PrismaContextoTransacao) {
    return contexto.cliente;
  }
  return prisma;
}
