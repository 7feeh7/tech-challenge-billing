import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { CobrancaGateway } from '../src/modules/cobrancas/application/ports/cobranca.gateway';
import { COBRANCA_GATEWAY } from '../src/modules/cobrancas/application/ports/tokens';
import { AprovarOrcamentoUseCase } from '../src/modules/orcamentos/application/use-cases/aprovar-orcamento.use-case';
import { ProcessarGerarOrcamentoUseCase } from '../src/modules/orcamentos/application/use-cases/processar-gerar-orcamento.use-case';
import { OrcamentosModule } from '../src/modules/orcamentos/orcamentos.module';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import {
  encerrarDublê,
  iniciarDublêOsReservas,
} from './helpers/dublê-os-reservas';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

describe('Orçamentos — consistência da aprovação (integração)', () => {
  let nestModule: TestingModule | undefined;
  let prisma: PrismaService;
  let processar: ProcessarGerarOrcamentoUseCase;
  let aprovar: AprovarOrcamentoUseCase;

  const exemplo = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'docs/contratos/exemplos/billing.gerar-orcamento.v1.json',
      ),
      'utf-8',
    ),
  );

  beforeAll(() => {
    exigirDatabaseUrl();
  });

  afterAll(async () => {
    await fecharModuloIntegracao(nestModule);
  });

  beforeEach(async () => {
    if (prisma) {
      await prisma.cobranca.deleteMany();
      await prisma.orcamentoItem.deleteMany();
      await prisma.orcamento.deleteMany();
    }
  });

  async function montarModulo(osUrl: string) {
    await fecharModuloIntegracao(nestModule);
    nestModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              OUTBOX_PUBLISHER_HABILITADO: 'false',
              SQS_CONSUMER_HABILITADO: 'false',
              APROVACAO_PROCESSADOR_HABILITADO: 'false',
              OS_SERVICE_BASE_URL: osUrl,
              OS_SERVICE_TOKEN: 'billing-os-test',
              OS_REQUEST_TIMEOUT_MS: '3000',
              OS_REQUEST_MAX_TENTATIVAS: '1',
              PRAZO_CARENCIA_MINUTOS: '2',
            }),
          ],
        }),
        PrismaModule,
        OrcamentosModule,
      ],
    }).compile();

    prisma = nestModule.get(PrismaService);
    processar = nestModule.get(ProcessarGerarOrcamentoUseCase);
    aprovar = nestModule.get(AprovarOrcamentoUseCase);
    await prisma.$executeRawUnsafe('SELECT 1');
  }

  async function criarOrcamento() {
    const evento = {
      ...exemplo,
      eventId: randomUUID(),
      correlationId: randomUUID(),
      ordemServicoId: randomUUID(),
      payload: {
        ...exemplo.payload,
        clienteId: randomUUID(),
        itens: exemplo.payload.itens.map((item: { itemId: string }) => ({
          ...item,
          itemId: randomUUID(),
        })),
      },
    };
    await processar.processar(evento);
    const orcamento = await prisma.orcamento.findFirst({
      orderBy: { criadoEm: 'desc' },
    });
    return orcamento?.id as string;
  }

  it('aprovação concorrente não duplica tentativa nem cobrança', async () => {
    const dublê = await iniciarDublêOsReservas('sucesso');
    try {
      await montarModulo(dublê.url);
      const id = await criarOrcamento();
      const [a, b] = await Promise.allSettled([
        aprovar.execute(id),
        aprovar.execute(id),
      ]);
      const status = [a, b].map((r) =>
        r.status === 'fulfilled' ? r.value.statusHttp : 'erro',
      );
      expect(status.filter((s) => s === 200).length).toBe(1);
      expect(await prisma.cobranca.count({ where: { orcamentoId: id } })).toBe(
        1,
      );
      const orc = await prisma.orcamento.findUnique({ where: { id } });
      expect(orc?.tentativaAprovacao).toBe(1);
    } finally {
      await encerrarDublê(dublê.servidor);
    }
  });

  it('rollback integral se cobrança falhar na mesma transação', async () => {
    const dublê = await iniciarDublêOsReservas('sucesso');
    try {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [
              () => ({
                OUTBOX_PUBLISHER_HABILITADO: 'false',
                SQS_CONSUMER_HABILITADO: 'false',
                OS_SERVICE_BASE_URL: dublê.url,
                OS_SERVICE_TOKEN: 'token',
                PRAZO_CARENCIA_MINUTOS: '2',
              }),
            ],
          }),
          PrismaModule,
          OrcamentosModule,
        ],
      })
        .overrideProvider(COBRANCA_GATEWAY)
        .useValue({
          criar: async () => {
            throw new Error('falha simulada na cobrança');
          },
          buscarPorOrcamentoId: async () => null,
        } satisfies CobrancaGateway)
        .compile();

      prisma = module.get(PrismaService);
      processar = module.get(ProcessarGerarOrcamentoUseCase);
      aprovar = module.get(AprovarOrcamentoUseCase);

      const id = await criarOrcamento();
      await expect(aprovar.execute(id)).rejects.toThrow('falha simulada');
      const orc = await prisma.orcamento.findUnique({ where: { id } });
      expect(orc?.situacao).toBe('APROVACAO_EM_ANDAMENTO');
      expect(await prisma.cobranca.count()).toBe(0);
    } finally {
      await encerrarDublê(dublê.servidor);
    }
  });

  it('processador recupera com a mesma Idempotency-Key', async () => {
    const dublê = await iniciarDublêOsReservas('sucesso');
    try {
      await montarModulo(dublê.url);
      const id = await criarOrcamento();
      await prisma.orcamento.update({
        where: { id },
        data: {
          situacao: 'APROVACAO_EM_ANDAMENTO',
          tentativaAprovacao: 1,
          bloqueadoAprovacaoAte: new Date(Date.now() + 60_000),
        },
      });
      await aprovar.reprocessarPendente(id);
      expect(dublê.chamadas[0]?.idempotencyKey).toBe(`reserva:${id}:1`);
      expect(
        (await prisma.orcamento.findUnique({ where: { id } }))?.situacao,
      ).toBe('APROVADO');
    } finally {
      await encerrarDublê(dublê.servidor);
    }
  });
});
