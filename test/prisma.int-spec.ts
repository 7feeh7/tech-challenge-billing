import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import {
  exigirDatabaseUrl,
  verificarConexaoPostgres,
} from './helpers/exigir-database-integracao';

describe('PrismaService (integração)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    exigirDatabaseUrl();

    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
    }).compile();

    prisma = module.get(PrismaService);
    await verificarConexaoPostgres(() => prisma.$queryRaw`SELECT 1`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('conecta e executa SELECT 1', async () => {
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 as one`;
    expect(rows[0]?.one).toBe(1);
  });
});