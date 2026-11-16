import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { OperacaoFinanceiraGateway } from '../src/modules/cancelamento-financeiro/application/ports/operacao-financeira.gateway';
import { OPERACAO_FINANCEIRA_GATEWAY } from '../src/modules/cancelamento-financeiro/application/ports/tokens';
import { ExecutarCancelamentoFinanceiroService } from '../src/modules/cancelamento-financeiro/application/services/executar-cancelamento-financeiro.service';
import { ProcessarCancelarFinanceiroUseCase } from '../src/modules/cancelamento-financeiro/application/use-cases/processar-cancelar-financeiro.use-case';
import { CancelamentoFinanceiroModule } from '../src/modules/cancelamento-financeiro/cancelamento-financeiro.module';
import type { CobrancaGateway } from '../src/modules/cobrancas/application/ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../src/modules/cobrancas/application/ports/mercado-pago.gateway';
import {
  COBRANCA_GATEWAY,
  MERCADO_PAGO_GATEWAY,
} from '../src/modules/cobrancas/application/ports/tokens';
import { Cobranca } from '../src/modules/cobrancas/domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../src/modules/cobrancas/domain/situacao-cobranca';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import type { UnitOfWork } from '../src/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '../src/shared/database/unit-of-work.port';
import { EVENTO_CANCELAR_FINANCEIRO } from '../src/shared/messaging/envelope';

const databaseUrl = process.env.DATABASE_URL;

describe('Cancelamento financeiro (integração)', () => {
  let prisma: PrismaService;
  let uow: UnitOfWork;
  let cobrancas: CobrancaGateway;
  let operacoes: OperacaoFinanceiraGateway;
  let processar: ProcessarCancelarFinanceiroUseCase;
  let executar: ExecutarCancelamentoFinanceiroService;

  const mpMock: MercadoPagoGateway = {
    criarOrder: jest.fn(),
    cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
    estornarTotal: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
    consultarOrder: jest.fn().mockResolvedValue({
      tipo: 'sucesso',
      order: {
        id: 'ORD-CANC',
        status: 'canceled',
        pagamentos: [],
      },
    }),
  };

  const pular = () => {
    if (!databaseUrl) {
      console.warn('DATABASE_URL ausente: testes de cancelamento ignorados.');
      return true;
    }
    return false;
  };

  beforeEach(async () => {
    if (pular()) return;

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
        CancelamentoFinanceiroModule,
      ],
    })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue(mpMock)
      .compile();

    prisma = module.get(PrismaService);
    uow = module.get(UNIT_OF_WORK);
    cobrancas = module.get(COBRANCA_GATEWAY);
    operacoes = module.get(OPERACAO_FINANCEIRA_GATEWAY);
    processar = module.get(ProcessarCancelarFinanceiroUseCase);
    executar = module.get(ExecutarCancelamentoFinanceiroService);

    await prisma.pendenciaEstorno.deleteMany();
    await prisma.operacaoFinanceira.deleteMany();
    await prisma.bloqueioCriacaoCobranca.deleteMany();
    await prisma.tentativaPagamentoRecusada.deleteMany();
    await prisma.avisoWebhookMercadoPago.deleteMany();
    await prisma.orderMercadoPago.deleteMany();
    await prisma.operacaoCriacaoOrder.deleteMany();
    await prisma.cobranca.deleteMany();
    await prisma.orcamentoItem.deleteMany();
    await prisma.orcamento.deleteMany();
    await prisma.mensagemOutbox.deleteMany();
    await prisma.mensagemProcessada.deleteMany();
  });

  it('fase 1 cria bloqueio e operação; fase 2 cancela cobrança pendente', async () => {
    if (pular()) return;

    const osId = randomUUID();
    const orcamentoId = randomUUID();
    const correlationId = randomUUID();

    await prisma.orcamento.create({
      data: {
        id: orcamentoId,
        ordemServicoId: osId,
        rodada: 1,
        clienteId: randomUUID(),
        correlationId,
        valorTotalCentavos: 5000,
        situacao: 'APROVADO',
      },
    });

    await uow.executar(async (ctx) => {
      await cobrancas.criar(
        ctx,
        new Cobranca({
          orcamentoId,
          ordemServicoId: osId,
          rodada: 1,
          clienteId: randomUUID(),
          correlationId,
          valorTotalCentavos: 5000,
          prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
          situacao: SituacaoCobranca.PENDENTE,
        }),
      );
    });

    const cobranca = await cobrancas.buscarPorOrdemServicoERodada(osId, 1);
    await prisma.orderMercadoPago.create({
      data: {
        cobrancaId: cobranca!.id as string,
        mercadoPagoOrderId: 'ORD-CANC',
        chaveIdempotencia: randomUUID(),
        checkoutUrl: 'https://checkout',
        ativa: true,
      },
    });

    const eventId = randomUUID();
    await processar.processar({
      eventId,
      eventType: EVENTO_CANCELAR_FINANCEIRO,
      version: 1,
      occurredAt: new Date().toISOString(),
      source: 'os-service',
      correlationId,
      causationId: null,
      ordemServicoId: osId,
      rodada: 1,
      payload: {
        etapaOrigem: 'CANCELAMENTO_OS',
        motivo: 'Teste',
        resultadoExecucao: 'REPARO_NAO_INICIADO',
      },
    });

    const operacao = await prisma.operacaoFinanceira.findUnique({
      where: { eventId },
    });
    expect(operacao).toBeTruthy();

    await executar.executar(operacao!.id);

    const atualizada = await cobrancas.buscarPorId(cobranca!.id as string);
    expect(atualizada?.situacao).toBe(SituacaoCobranca.CANCELADA);

    const concluida = await operacoes.buscarPorId(operacao!.id);
    expect(concluida?.situacao).toBe('CONCLUIDA');
    expect(concluida?.resultado).toBe('CANCELADA');
  });
});
