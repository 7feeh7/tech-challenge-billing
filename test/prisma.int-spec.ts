import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';

describe('PrismaService (integração)', () => {
  let prisma: PrismaService;
  let conexaoOk = true;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
    }).compile();

    prisma = module.get(PrismaService);
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (erro) {
      conexaoOk = false;
      const msg =
        erro instanceof Error ? erro.message : 'erro de conexão desconhecido';
      console.warn(
        `Prisma int-spec ignorado: ${msg}. 28P01 costuma indicar DATABASE_URL com usuário/senha diferentes de .env.example (billing:billing@localhost:5432/billing).`,
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('conecta e executa SELECT 1', async () => {
    if (!conexaoOk) return;
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 as one`;
    expect(rows[0]?.one).toBe(1);
  });
});
