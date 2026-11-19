import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { MERCADO_PAGO_GATEWAY } from '../src/modules/cobrancas/application/ports/tokens';
import { ConciliarCobrancaService } from '../src/modules/cobrancas/application/services/conciliar-cobranca.service';
import { ExecutarEstornoAutomaticoService } from '../src/modules/cobrancas/application/services/executar-estorno-automatico.service';
import { ExpirarCobrancaService } from '../src/modules/cobrancas/application/services/expirar-cobranca.service';
import { CobrancasModule } from '../src/modules/cobrancas/cobrancas.module';
import { SituacaoCobranca } from '../src/modules/cobrancas/domain/situacao-cobranca';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { EVENTO_PAGAMENTO_TARDIO_REGISTRADO } from '../src/shared/messaging/envelope';
import { configIntegracaoCobrancas } from './helpers/config-integracao-cobrancas';
import {
  criarDubleMercadoPagoEstorno,
  type DubleMercadoPagoEstorno,
} from './helpers/duble-mercado-pago-estorno';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

const MAX_TENTATIVAS = 3;
const PRAZO_VENCIDO = new Date('2020-01-01T00:00:00.000Z');

describe('Pagamento tardio (integração)', () => {
  let nestModule: TestingModule;
  let prisma: PrismaService;
  let expirar: ExpirarCobrancaService;
  let conciliar: ConciliarCobrancaService;
  let executarEstorno: ExecutarEstornoAutomaticoService;
  let mp: DubleMercadoPagoEstorno;

  beforeAll(() => {
    exigirDatabaseUrl();
  });

  beforeEach(async () => {
    mp = criarDubleMercadoPagoEstorno();
    nestModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              ...configIntegracaoCobrancas(),
              CANCELAMENTO_FINANCEIRO_MAX_TENTATIVAS_MP: String(MAX_TENTATIVAS),
              CANCELAMENTO_FINANCEIRO_RETRY_MP_MS: '1',
            }),
          ],
        }),
        PrismaModule,
        CobrancasModule,
      ],
    })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue(mp.gateway)
      .compile();

    prisma = nestModule.get(PrismaService);
    expirar = nestModule.get(ExpirarCobrancaService);
    conciliar = nestModule.get(ConciliarCobrancaService);
    executarEstorno = nestModule.get(ExecutarEstornoAutomaticoService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await prisma.pendenciaEstorno.deleteMany();
    await prisma.tentativaPagamentoRecusada.deleteMany();
    await prisma.avisoWebhookMercadoPago.deleteMany();
    await prisma.orderMercadoPago.deleteMany();
    await prisma.operacaoCriacaoOrder.deleteMany();
    await prisma.cobranca.deleteMany();
    await prisma.orcamentoItem.deleteMany();
    await prisma.orcamento.deleteMany();
    await prisma.mensagemOutbox.deleteMany();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fecharModuloIntegracao(nestModule);
  });

  async function criarCobrancaComOrder(
    situacao: SituacaoCobranca,
    opcoes: { ativa: boolean } = { ativa: true },
  ) {
    const orcamentoId = randomUUID();
    const ordemServicoId = randomUUID();
    const correlationId = randomUUID();
    await prisma.orcamento.create({
      data: {
        id: orcamentoId,
        ordemServicoId,
        rodada: 1,
        clienteId: randomUUID(),
        correlationId,
        valorTotalCentavos: 25000,
        situacao: 'APROVADO',
      },
    });
    const cobranca = await prisma.cobranca.create({
      data: {
        orcamentoId,
        ordemServicoId,
        rodada: 1,
        clienteId: randomUUID(),
        correlationId,
        valorTotalCentavos: 25000,
        prazoPagamento: PRAZO_VENCIDO,
        situacao,
      },
    });
    await prisma.orderMercadoPago.create({
      data: {
        cobrancaId: cobranca.id,
        mercadoPagoOrderId: 'ORD-TARDIA',
        chaveIdempotencia: randomUUID(),
        checkoutUrl: 'https://checkout/tardia',
        ativa: opcoes.ativa,
      },
    });
    mp.pagar('ORD-TARDIA', '2026-11-15T12:00:00.000Z');
    return { cobrancaId: cobranca.id, ordemServicoId };
  }

  const publicadas = async () =>
    (
      await prisma.mensagemOutbox.findMany({
        where: { eventType: EVENTO_PAGAMENTO_TARDIO_REGISTRADO },
      })
    ).map((m) => (m.envelope as { payload: Record<string, unknown> }).payload);

  const estornoTardio = () =>
    prisma.estornoAutomatico.findFirstOrThrow({
      where: { tipo: 'PAGAMENTO_TARDIO' },
    });

  const situacaoDa = async (cobrancaId: string) =>
    (await prisma.cobranca.findUniqueOrThrow({ where: { id: cobrancaId } }))
      .situacao;

  async function repetirCiclos(estornoId: string, vezes: number) {
    for (let i = 0; i < vezes; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await executarEstorno.executar(estornoId);
    }
  }

  it('com estorno integral confirmado publica ESTORNO_AUTOMATICO uma única vez e expira a cobrança', async () => {
    const { cobrancaId } = await criarCobrancaComOrder(
      SituacaoCobranca.PENDENTE,
    );

    await expirar.expirarPorCobrancaId(cobrancaId);
    await expirar.expirarPorCobrancaId(cobrancaId);

    expect(await publicadas()).toEqual([
      {
        cobrancaId,
        orderId: 'ORD-TARDIA',
        aprovadoEm: '2026-11-15T12:00:00.000Z',
        tratamento: 'ESTORNO_AUTOMATICO',
      },
    ]);
    expect((await estornoTardio()).situacao).toBe('CONCLUIDO');
    expect(await situacaoDa(cobrancaId)).toBe(SituacaoCobranca.EXPIRADA);
    expect(mp.chamadasEstorno).toHaveLength(1);
  });

  it('estorno parcial não publica ESTORNO_AUTOMATICO e é retomado com a mesma chave', async () => {
    const { cobrancaId } = await criarCobrancaComOrder(
      SituacaoCobranca.PENDENTE,
    );
    mp.definirModoEstorno('parcial');

    await expirar.expirarPorCobrancaId(cobrancaId);

    const emAndamento = await estornoTardio();
    expect(emAndamento).toMatchObject({
      situacao: 'EM_ANDAMENTO',
      tentativas: 1,
    });
    expect(await publicadas()).toHaveLength(0);
    expect(await situacaoDa(cobrancaId)).toBe(SituacaoCobranca.PENDENTE);

    mp.definirModoEstorno('integral');
    await repetirCiclos(emAndamento.id, 1);

    expect(await publicadas()).toEqual([
      expect.objectContaining({ tratamento: 'ESTORNO_AUTOMATICO' }),
    ]);
    expect(new Set(mp.chamadasEstorno.map((c) => c.chave)).size).toBe(1);
    expect(await situacaoDa(cobrancaId)).toBe(SituacaoCobranca.EXPIRADA);
  });

  it.each(['parcial', 'indeterminado', 'recusado'] as const)(
    'estorno %s até esgotar as tentativas abre pendência manual e publica PENDENCIA_MANUAL',
    async (modo) => {
      const { cobrancaId, ordemServicoId } = await criarCobrancaComOrder(
        SituacaoCobranca.PENDENTE,
      );
      mp.definirModoEstorno(modo);

      await expirar.expirarPorCobrancaId(cobrancaId);
      await repetirCiclos((await estornoTardio()).id, MAX_TENTATIVAS);

      const final = await estornoTardio();
      expect(final.situacao).toBe('PENDENCIA_MANUAL');
      const pendencia = await prisma.pendenciaEstorno.findUniqueOrThrow({
        where: { id: final.pendenciaId as string },
      });
      expect(pendencia).toMatchObject({
        cobrancaId,
        ordemServicoId,
        situacao: 'ABERTA',
      });
      expect(await publicadas()).toEqual([
        expect.objectContaining({
          orderId: 'ORD-TARDIA',
          tratamento: 'PENDENCIA_MANUAL',
        }),
      ]);
      expect(new Set(mp.chamadasEstorno.map((c) => c.chave)).size).toBe(1);
      expect(await situacaoDa(cobrancaId)).toBe(SituacaoCobranca.EXPIRADA);
    },
  );

  it.each([
    [SituacaoCobranca.EXPIRADA],
    [SituacaoCobranca.CANCELADA],
    [SituacaoCobranca.INTENCAO],
  ])(
    'webhook de order desativada de cobrança %s estorna e publica o pagamento tardio',
    async (situacao) => {
      const { cobrancaId } = await criarCobrancaComOrder(situacao, {
        ativa: false,
      });

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-TARDIA');
      await conciliar.conciliarPorMercadoPagoOrderId('ORD-TARDIA');

      expect(await publicadas()).toEqual([
        expect.objectContaining({
          cobrancaId,
          orderId: 'ORD-TARDIA',
          tratamento: 'ESTORNO_AUTOMATICO',
        }),
      ]);
      expect(mp.chamadasEstorno).toHaveLength(1);
      expect(await situacaoDa(cobrancaId)).toBe(situacao);
    },
  );

  it('pagamento aprovado dentro do prazo, visto só na expiração, confirma a cobrança sem estornar a legítima', async () => {
    const { cobrancaId } = await criarCobrancaComOrder(
      SituacaoCobranca.PENDENTE,
    );
    mp.pagar('ORD-TARDIA', '2019-12-31T23:00:00.000Z');

    await expirar.expirarPorCobrancaId(cobrancaId);
    await expirar.expirarPorCobrancaId(cobrancaId);

    expect(await situacaoDa(cobrancaId)).toBe(SituacaoCobranca.PAGA);
    const order = await prisma.orderMercadoPago.findUniqueOrThrow({
      where: { mercadoPagoOrderId: 'ORD-TARDIA' },
    });
    expect(order.confirmouPagamento).toBe(true);
    const confirmados = await prisma.mensagemOutbox.findMany({
      where: { eventType: 'billing.pagamento-confirmado.v1' },
    });
    expect(
      confirmados.map(
        (m) => (m.envelope as { payload: { orderId: string } }).payload.orderId,
      ),
    ).toEqual(['ORD-TARDIA']);
    expect(mp.chamadasEstorno).toHaveLength(0);
    expect(await publicadas()).toHaveLength(0);
    expect(await prisma.estornoAutomatico.count()).toBe(0);
  });
});
