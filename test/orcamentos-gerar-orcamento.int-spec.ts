import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ProcessarGerarOrcamentoUseCase } from '../src/modules/orcamentos/application/use-cases/processar-gerar-orcamento.use-case';
import { OrcamentosModule } from '../src/modules/orcamentos/orcamentos.module';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { EVENTO_ORCAMENTO_GERADO } from '../src/shared/messaging/envelope';
import { MensageriaModule } from '../src/shared/messaging/mensageria.module';

const databaseUrl = process.env.DATABASE_URL;

describe('Gerar orçamento (integração PostgreSQL)', () => {
  let prisma: PrismaService;
  let processar: ProcessarGerarOrcamentoUseCase;

  const exemplo = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'docs/contratos/exemplos/billing.gerar-orcamento.v1.json',
      ),
      'utf-8',
    ),
  );

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              OUTBOX_PUBLISHER_HABILITADO: 'false',
              SQS_CONSUMER_HABILITADO: 'false',
            }),
          ],
        }),
        PrismaModule,
        MensageriaModule,
        OrcamentosModule,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    processar = module.get(ProcessarGerarOrcamentoUseCase);

    await prisma.$executeRawUnsafe('SELECT 1');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    if (!databaseUrl || !prisma) return;
    await prisma.mensagemOutbox.deleteMany();
    await prisma.mensagemProcessada.deleteMany();
    await prisma.orcamentoItem.deleteMany();
    await prisma.orcamento.deleteMany();
  });

  const pularSemBanco = () => {
    if (!databaseUrl) {
      console.warn('DATABASE_URL ausente: teste de integração ignorado.');
      return true;
    }
    return false;
  };

  it('persiste orçamento com valor soma dos itens e evento na outbox', async () => {
    if (pularSemBanco()) return;

    await processar.processar(exemplo);

    const orcamentos = await prisma.orcamento.findMany({
      include: { itens: true },
    });
    expect(orcamentos).toHaveLength(1);
    expect(orcamentos[0]?.valorTotalCentavos).toBe(15000);

    const outbox = await prisma.mensagemOutbox.findMany();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(EVENTO_ORCAMENTO_GERADO);
  });

  it('repetição do comando não cria segundo orçamento', async () => {
    if (pularSemBanco()) return;

    await processar.processar(exemplo);
    await processar.processar(exemplo);

    const count = await prisma.orcamento.count();
    expect(count).toBe(1);
  });
});
