import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { CobrancaGateway } from '../src/modules/cobrancas/application/ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../src/modules/cobrancas/application/ports/mercado-pago.gateway';
import {
  COBRANCA_GATEWAY,
  MERCADO_PAGO_GATEWAY,
} from '../src/modules/cobrancas/application/ports/tokens';
import { ConciliarCobrancaService } from '../src/modules/cobrancas/application/services/conciliar-cobranca.service';
import { CriarOrderMercadoPagoService } from '../src/modules/cobrancas/application/services/criar-order-mercado-pago.service';
import { CobrancasModule } from '../src/modules/cobrancas/cobrancas.module';
import { Cobranca } from '../src/modules/cobrancas/domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../src/modules/cobrancas/domain/situacao-cobranca';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import type { UnitOfWork } from '../src/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '../src/shared/database/unit-of-work.port';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';

describe('Cobranças — Mercado Pago (integração)', () => {
  let prisma: PrismaService;
  let uow: UnitOfWork;
  let cobrancas: CobrancaGateway;
  let criarOrder: CriarOrderMercadoPagoService;
  let conciliar: ConciliarCobrancaService;

  const mpMock: MercadoPagoGateway = {
    criarOrder: jest.fn().mockResolvedValue({
      tipo: 'sucesso',
      orderId: 'ORD-INT-1',
      checkoutUrl: 'https://checkout/int',
      status: 'action_required',
      statusDetail: 'waiting_for_payment',
    }),
    cancelarOrder: jest.fn(),
    estornarTotal: jest.fn(),
    consultarOrder: jest.fn().mockResolvedValue({
      tipo: 'sucesso',
      order: {
        id: 'ORD-INT-1',
        status: 'processed',
        statusDetail: 'accredited',
        pagamentos: [
          {
            id: 'PAY-INT-1',
            status: 'accredited',
            dateApproved: '2026-11-15T12:00:00.000Z',
          },
        ],
      },
    }),
  };

  beforeAll(() => {
    exigirDatabaseUrl();
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              OUTBOX_PUBLISHER_HABILITADO: 'false',
              SQS_CONSUMER_HABILITADO: 'false',
              COBRANCA_CRIACAO_PROCESSADOR_HABILITADO: 'false',
              COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO: 'false',
              MP_PAYER_EMAIL: 'comprador@example.com',
            }),
          ],
        }),
        PrismaModule,
        CobrancasModule,
      ],
    })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue(mpMock)
      .compile();

    prisma = module.get(PrismaService);
    uow = module.get(UNIT_OF_WORK);
    cobrancas = module.get(COBRANCA_GATEWAY);
    criarOrder = module.get(CriarOrderMercadoPagoService);
    conciliar = module.get(ConciliarCobrancaService);

    await prisma.tentativaPagamentoRecusada.deleteMany();
    await prisma.avisoWebhookMercadoPago.deleteMany();
    await prisma.orderMercadoPago.deleteMany();
    await prisma.operacaoCriacaoOrder.deleteMany();
    await prisma.cobranca.deleteMany();
    await prisma.orcamentoItem.deleteMany();
    await prisma.orcamento.deleteMany();
    await prisma.mensagemOutbox.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('cria order, publica CobrancaCriada e confirma pagamento por consulta', async () => {
    const orcamentoId = randomUUID();
    const ordemServicoId = randomUUID();
    const clienteId = randomUUID();
    const correlationId = randomUUID();

    await prisma.orcamento.create({
      data: {
        id: orcamentoId,
        ordemServicoId,
        rodada: 1,
        clienteId,
        correlationId,
        valorTotalCentavos: 25000,
        situacao: 'APROVADO',
        prazoReferencia: new Date('2099-12-31T00:00:00.000Z'),
      },
    });

    const cobranca = Cobranca.criarIntencaoAPartirDoOrcamento({
      orcamentoId,
      ordemServicoId,
      rodada: 1,
      clienteId,
      correlationId,
      valorTotalCentavos: 25000,
      prazoPagamento: new Date('2099-12-31T00:00:00.000Z'),
    });

    await uow.executar((ctx) => cobrancas.criar(ctx, cobranca));
    const persistida = await cobrancas.buscarPorOrcamentoId(orcamentoId);
    expect(persistida?.id).toBeDefined();

    await criarOrder.executar(persistida?.id as string);

    const pendente = await cobrancas.buscarPorId(persistida?.id as string);
    expect(pendente?.situacao).toBe(SituacaoCobranca.PENDENTE);
    expect(pendente?.linkPagamento).toContain('checkout');

    const outbox = await prisma.mensagemOutbox.findMany({
      where: { eventType: 'billing.cobranca-criada.v1' },
    });
    expect(outbox).toHaveLength(1);

    await conciliar.conciliarPorCobrancaId(persistida?.id as string);
    const paga = await cobrancas.buscarPorId(persistida?.id as string);
    expect(paga?.situacao).toBe(SituacaoCobranca.PAGA);

    const pagamento = await prisma.mensagemOutbox.findMany({
      where: { eventType: 'billing.pagamento-confirmado.v1' },
    });
    expect(pagamento).toHaveLength(1);
  });
});
