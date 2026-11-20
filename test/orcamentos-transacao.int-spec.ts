import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ProcessarGerarOrcamentoUseCase } from '../src/modules/orcamentos/application/use-cases/processar-gerar-orcamento.use-case';
import { RejeitarOrcamentoUseCase } from '../src/modules/orcamentos/application/use-cases/rejeitar-orcamento.use-case';
import { SituacaoOrcamentoInvalidaError } from '../src/modules/orcamentos/domain/errors/orcamento.errors';
import { OrcamentosModule } from '../src/modules/orcamentos/orcamentos.module';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { PrismaUnitOfWork } from '../src/shared/database/prisma-unit-of-work';
import type { OutboxGateway } from '../src/shared/messaging/application/ports/outbox.gateway';
import { OUTBOX_GATEWAY } from '../src/shared/messaging/application/ports/tokens';
import { PrismaMensagemProcessadaGateway } from '../src/shared/messaging/infra/persistence/prisma-mensagem-processada.gateway';
import { MensageriaModule } from '../src/shared/messaging/mensageria.module';
import {
  exigirDatabaseUrl,
  verificarConexaoPostgres,
} from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

describe('Orçamentos — consistência transacional (integração)', () => {
  let nestModule: TestingModule;
  let prisma: PrismaService;
  let processar: ProcessarGerarOrcamentoUseCase;
  let rejeitar: RejeitarOrcamentoUseCase;

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
    exigirDatabaseUrl();

    nestModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              OUTBOX_PUBLISHER_HABILITADO: 'false',
              SQS_CONSUMER_HABILITADO: 'false',
              APROVACAO_PROCESSADOR_HABILITADO: 'false',
            }),
          ],
        }),
        PrismaModule,
        MensageriaModule,
        OrcamentosModule,
      ],
    }).compile();

    prisma = nestModule.get(PrismaService);
    processar = nestModule.get(ProcessarGerarOrcamentoUseCase);
    rejeitar = nestModule.get(RejeitarOrcamentoUseCase);
    await verificarConexaoPostgres(() => prisma.$queryRaw`SELECT 1`);
  });

  afterAll(async () => {
    await fecharModuloIntegracao(nestModule);
  });

  beforeEach(async () => {
    await prisma.mensagemOutbox.deleteMany();
    await prisma.mensagemProcessada.deleteMany();
    await prisma.orcamentoItem.deleteMany();
    await prisma.orcamento.deleteMany();
  });

  it('grava orçamento, itens, mensagem processada e outbox na mesma unidade', async () => {
    await processar.processar(exemplo);

    expect(await prisma.orcamento.count()).toBe(1);
    expect(await prisma.orcamentoItem.count()).toBe(1);
    expect(await prisma.mensagemProcessada.count()).toBe(1);
    expect(await prisma.mensagemOutbox.count()).toBe(1);
  });

  it('faz rollback integral se a outbox falhar na mesma transação', async () => {
    const outboxQuebrada: OutboxGateway = {
      registrar: async () => {
        throw new Error('falha simulada na outbox');
      },
    };

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        MensageriaModule,
        OrcamentosModule,
      ],
    })
      .overrideProvider(OUTBOX_GATEWAY)
      .useValue(outboxQuebrada)
      .compile();

    const processarFalho = module.get(ProcessarGerarOrcamentoUseCase);

    await expect(processarFalho.processar(exemplo)).rejects.toThrow(
      'falha simulada',
    );

    expect(await prisma.orcamento.count()).toBe(0);
    expect(await prisma.mensagemProcessada.count()).toBe(0);
    expect(await prisma.mensagemOutbox.count()).toBe(0);

    await module.close();
  });

  it('reentrega concorrente não duplica orçamento nem outbox', async () => {
    await Promise.all([
      processar.processar(exemplo),
      processar.processar(exemplo),
    ]);

    expect(await prisma.orcamento.count()).toBe(1);
    expect(await prisma.mensagemOutbox.count()).toBe(1);
  });

  it('comando com outro eventId e mesma OS/rodada não duplica orçamento', async () => {
    await processar.processar(exemplo);
    await processar.processar({
      ...exemplo,
      eventId: randomUUID(),
    });

    expect(await prisma.orcamento.count()).toBe(1);
    expect(await prisma.mensagemProcessada.count()).toBe(2);
    expect(await prisma.mensagemOutbox.count()).toBe(1);
  });

  it('rejeição repetida não duplica evento na outbox', async () => {
    await processar.processar(exemplo);
    const orc = await prisma.orcamento.findFirst();
    const id = orc?.id as string;

    await rejeitar.execute(id, { motivo: 'Não quero' });
    expect(await prisma.mensagemOutbox.count()).toBe(2);

    await expect(
      rejeitar.execute(id, { motivo: 'Tentativa 2' }),
    ).rejects.toThrow(SituacaoOrcamentoInvalidaError);
    expect(await prisma.mensagemOutbox.count()).toBe(2);
  });

  it('PrismaUnitOfWork desfaz escrita ao falhar no trabalho', async () => {
    const uow = new PrismaUnitOfWork(prisma, {
      get: () => '10000',
    } as never);
    const mensagens = new PrismaMensagemProcessadaGateway(prisma);

    await expect(
      uow.executar(async (contexto) => {
        await mensagens.registrar(contexto, randomUUID(), 'hash-teste');
        throw new Error('força rollback');
      }),
    ).rejects.toThrow('força rollback');

    expect(await prisma.mensagemProcessada.count()).toBe(0);
  });
});
