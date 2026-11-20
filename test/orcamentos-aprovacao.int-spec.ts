import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AprovarOrcamentoUseCase } from '../src/modules/orcamentos/application/use-cases/aprovar-orcamento.use-case';
import { ProcessarGerarOrcamentoUseCase } from '../src/modules/orcamentos/application/use-cases/processar-gerar-orcamento.use-case';
import { EstoqueInsuficienteAprovacaoError } from '../src/modules/orcamentos/domain/errors/orcamento.errors';
import { SituacaoOrcamento } from '../src/modules/orcamentos/domain/situacao-orcamento';
import { OrcamentosModule } from '../src/modules/orcamentos/orcamentos.module';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import {
  encerrarDuble,
  iniciarDubleOsReservas,
} from './helpers/duble-os-reservas';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

describe('Orçamentos — aprovação com reserva (integração)', () => {
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
      await prisma.mensagemOutbox.deleteMany();
      await prisma.mensagemProcessada.deleteMany();
      await prisma.orcamentoItem.deleteMany();
      await prisma.orcamento.deleteMany();
    }
  });

  async function montarModulo(osUrl: string, timeoutMs: string) {
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
              OS_REQUEST_TIMEOUT_MS: timeoutMs,
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

  it('aprova com reserva confirmada e persiste intenção de cobrança', async () => {
    const duble = await iniciarDubleOsReservas('sucesso');
    try {
      await montarModulo(duble.url, '3000');
      const id = await criarOrcamento();
      const resultado = await aprovar.execute(id);
      expect(resultado.statusHttp).toBe(200);
      expect(resultado.orcamento.situacao).toBe(SituacaoOrcamento.APROVADO);
      expect(duble.chamadas[0]?.idempotencyKey).toBe(`reserva:${id}:1`);

      const cobranca = await prisma.cobranca.findUnique({
        where: { orcamentoId: id },
      });
      expect(cobranca?.situacao).toBe('INTENCAO');
    } finally {
      await encerrarDuble(duble.servidor);
    }
  });

  it('retorna 409 de estoque e mantém orçamento aguardando em GERADO', async () => {
    const duble = await iniciarDubleOsReservas('estoque');
    try {
      await montarModulo(duble.url, '3000');
      const id = await criarOrcamento();
      await expect(aprovar.execute(id)).rejects.toBeInstanceOf(
        EstoqueInsuficienteAprovacaoError,
      );
      const row = await prisma.orcamento.findUnique({ where: { id } });
      expect(row?.situacao).toBe(SituacaoOrcamento.GERADO);
      expect(row?.tentativaAprovacao).toBe(1);

      await expect(aprovar.execute(id)).rejects.toBeInstanceOf(
        EstoqueInsuficienteAprovacaoError,
      );
      const row2 = await prisma.orcamento.findUnique({ where: { id } });
      expect(row2?.tentativaAprovacao).toBe(2);
      expect(duble.chamadas.map((c) => c.idempotencyKey)).toEqual([
        `reserva:${id}:1`,
        `reserva:${id}:2`,
      ]);
    } finally {
      await encerrarDuble(duble.servidor);
    }
  });

  it('timeout na reserva responde 202 e consulta subsequente não duplica operação', async () => {
    const duble = await iniciarDubleOsReservas('timeout');
    try {
      await montarModulo(duble.url, '50');
      const id = await criarOrcamento();
      const resultado = await aprovar.execute(id);
      expect(resultado.statusHttp).toBe(202);

      const consulta = await aprovar.execute(id);
      expect(consulta.statusHttp).toBe(202);
      expect(duble.chamadas).toHaveLength(1);
    } finally {
      await encerrarDuble(duble.servidor);
    }
  });
});
