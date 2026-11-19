import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ResolverPendenciaEstornoUseCase } from '../src/modules/cancelamento-financeiro/application/use-cases/resolver-pendencia-estorno.use-case';
import { MERCADO_PAGO_GATEWAY } from '../src/modules/cobrancas/application/ports/tokens';
import { ConciliarCobrancaService } from '../src/modules/cobrancas/application/services/conciliar-cobranca.service';
import { ExecutarEstornoAutomaticoService } from '../src/modules/cobrancas/application/services/executar-estorno-automatico.service';
import { ProcessarNotificacaoMercadoPagoUseCase } from '../src/modules/cobrancas/application/use-cases/processar-notificacao-mercado-pago.use-case';
import { CobrancasModule } from '../src/modules/cobrancas/cobrancas.module';
import { SituacaoCobranca } from '../src/modules/cobrancas/domain/situacao-cobranca';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import type { OutboxGateway } from '../src/shared/messaging/application/ports/outbox.gateway';
import { OUTBOX_GATEWAY } from '../src/shared/messaging/application/ports/tokens';
import {
  EVENTO_ESTORNO_CONCLUIDO,
  EVENTO_PAGAMENTO_CONFIRMADO,
} from '../src/shared/messaging/envelope';
import { configIntegracaoCobrancas } from './helpers/config-integracao-cobrancas';
import {
  criarDubleMercadoPagoEstorno,
  type DubleMercadoPagoEstorno,
} from './helpers/duble-mercado-pago-estorno';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

const MAX_TENTATIVAS = 3;

describe('Segundo pagamento (integração)', () => {
  let nestModule: TestingModule;
  let prisma: PrismaService;
  let conciliar: ConciliarCobrancaService;
  let notificacao: ProcessarNotificacaoMercadoPagoUseCase;
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
    conciliar = nestModule.get(ConciliarCobrancaService);
    notificacao = nestModule.get(ProcessarNotificacaoMercadoPagoUseCase);
    executarEstorno = nestModule.get(ExecutarEstornoAutomaticoService);

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

  async function criarCobranca(
    situacao: SituacaoCobranca,
    prazoPagamento = new Date('2099-12-31T00:00:00.000Z'),
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
        prazoPagamento,
        situacao,
        pagamentoConfirmadoEm:
          situacao === SituacaoCobranca.PENDENTE
            ? null
            : new Date('2026-11-15T11:00:00.000Z'),
      },
    });
    return { cobrancaId: cobranca.id, ordemServicoId, correlationId };
  }

  function criarOrder(
    cobrancaId: string,
    mercadoPagoOrderId: string,
    opcoes: { ativa: boolean; confirmouPagamento: boolean },
  ) {
    return prisma.orderMercadoPago.create({
      data: {
        cobrancaId,
        mercadoPagoOrderId,
        chaveIdempotencia: randomUUID(),
        checkoutUrl: `https://checkout/${mercadoPagoOrderId}`,
        ...opcoes,
      },
    });
  }

  async function cenarioCobrancaPagaPorA(
    situacao: SituacaoCobranca = SituacaoCobranca.PAGA,
  ) {
    const cobranca = await criarCobranca(situacao);
    await criarOrder(cobranca.cobrancaId, 'ORD-A', {
      ativa: situacao === SituacaoCobranca.PAGA,
      confirmouPagamento: true,
    });
    await criarOrder(cobranca.cobrancaId, 'ORD-B', {
      ativa: false,
      confirmouPagamento: false,
    });
    mp.pagar('ORD-A', '2026-11-15T11:00:00.000Z');
    mp.pagar('ORD-B', '2026-11-15T12:00:00.000Z');
    return cobranca;
  }

  const outbox = (eventType: string) =>
    prisma.mensagemOutbox.findMany({
      where: { eventType },
      orderBy: { criadoEm: 'asc' },
    });

  const payloadDe = (mensagem: { envelope: unknown }) =>
    (mensagem.envelope as { payload: Record<string, unknown> }).payload;

  async function esperarFimDaEspera() {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async function estornoDe(mercadoPagoOrderId: string) {
    const order = await prisma.orderMercadoPago.findUniqueOrThrow({
      where: { mercadoPagoOrderId },
    });
    return prisma.estornoAutomatico.findUnique({
      where: { orderMercadoPagoId: order.id },
    });
  }

  describe('webhook repetido e conciliação concorrente', () => {
    it('geram um registro, um estorno, um PagamentoConfirmado e um EstornoConcluido da segunda order', async () => {
      const { cobrancaId } = await cenarioCobrancaPagaPorA();

      await Promise.all([
        notificacao.execute({ mercadoPagoOrderId: 'ORD-B', requestId: 'r1' }),
        notificacao.execute({ mercadoPagoOrderId: 'ORD-B', requestId: 'r2' }),
        conciliar.conciliarPorMercadoPagoOrderId('ORD-B'),
        conciliar.conciliarPorMercadoPagoOrderId('ORD-B'),
      ]);
      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');

      expect(await prisma.estornoAutomatico.count()).toBe(1);
      const estorno = await estornoDe('ORD-B');
      expect(estorno).toMatchObject({
        tipo: 'SEGUNDO_PAGAMENTO',
        situacao: 'CONCLUIDO',
        valorCentavos: 25000,
      });

      const confirmados = await outbox(EVENTO_PAGAMENTO_CONFIRMADO);
      expect(confirmados.map((m) => payloadDe(m).orderId)).toEqual(['ORD-B']);
      expect(payloadDe(confirmados[0])).toMatchObject({
        cobrancaId,
        valorCentavos: 25000,
        aprovadoEm: '2026-11-15T12:00:00.000Z',
      });

      const estornos = await outbox(EVENTO_ESTORNO_CONCLUIDO);
      expect(estornos).toHaveLength(1);
      expect(payloadDe(estornos[0])).toEqual({
        cobrancaId,
        orderId: 'ORD-B',
        valorEstornadoCentavos: 25000,
        estornadoEm: expect.any(String),
        tipoEstorno: 'INTEGRAL',
        statusOrderMercadoPago: 'refunded',
        origemEstorno: 'SEGUNDO_PAGAMENTO',
      });

      const chaves = new Set(mp.chamadasEstorno.map((c) => c.chave));
      expect(chaves).toEqual(new Set([estorno?.chaveIdempotencia]));
    });

    it('nunca estorna a order que confirmou o pagamento e mantém a cobrança PAGA', async () => {
      const { cobrancaId } = await cenarioCobrancaPagaPorA();

      await Promise.all([
        conciliar.conciliarPorMercadoPagoOrderId('ORD-B'),
        conciliar.conciliarPorMercadoPagoOrderId('ORD-A'),
        conciliar.conciliarPorCobrancaId(cobrancaId),
      ]);

      expect(mp.chamadasEstorno.map((c) => c.orderId)).toEqual(['ORD-B']);
      const cobranca = await prisma.cobranca.findUniqueOrThrow({
        where: { id: cobrancaId },
      });
      expect(cobranca.situacao).toBe(SituacaoCobranca.PAGA);
      expect(await estornoDe('ORD-A')).toBeNull();
    });

    it('webhook da order legítima não consulta o Mercado Pago nem registra nada', async () => {
      await cenarioCobrancaPagaPorA();

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-A');

      expect(mp.chamadasConsulta).toHaveLength(0);
      expect(await prisma.estornoAutomatico.count()).toBe(0);
      expect(await prisma.mensagemOutbox.count()).toBe(0);
    });
  });

  describe.each([
    SituacaoCobranca.PAGA,
    SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
    SituacaoCobranca.ESTORNADA,
    SituacaoCobranca.PENDENCIA_MANUAL,
  ])('cobrança %s', (situacao) => {
    it('registra, estorna e publica o segundo pagamento sem alterar a cobrança', async () => {
      const { cobrancaId } = await cenarioCobrancaPagaPorA(situacao);

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');

      expect((await estornoDe('ORD-B'))?.situacao).toBe('CONCLUIDO');
      expect(await outbox(EVENTO_PAGAMENTO_CONFIRMADO)).toHaveLength(1);
      expect(await outbox(EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(1);
      expect(mp.chamadasEstorno.map((c) => c.orderId)).toEqual(['ORD-B']);
      const cobranca = await prisma.cobranca.findUniqueOrThrow({
        where: { id: cobrancaId },
      });
      expect(cobranca.situacao).toBe(situacao);
    });
  });

  describe('pagamentos simultâneos de duas orders de cobrança ainda pendente', () => {
    it('confirma uma só order, trata a outra como segundo pagamento e estorna só a segunda', async () => {
      const cobranca = await criarCobranca(SituacaoCobranca.PENDENTE);
      await criarOrder(cobranca.cobrancaId, 'ORD-A', {
        ativa: false,
        confirmouPagamento: false,
      });
      await criarOrder(cobranca.cobrancaId, 'ORD-B', {
        ativa: true,
        confirmouPagamento: false,
      });
      mp.pagar('ORD-A', '2026-11-15T11:00:00.000Z');
      mp.pagar('ORD-B', '2026-11-15T12:00:00.000Z');

      await Promise.all([
        conciliar.conciliarPorMercadoPagoOrderId('ORD-A'),
        conciliar.conciliarPorMercadoPagoOrderId('ORD-B'),
      ]);

      const confirmadoras = await prisma.orderMercadoPago.findMany({
        where: { cobrancaId: cobranca.cobrancaId, confirmouPagamento: true },
      });
      expect(confirmadoras).toHaveLength(1);
      const legitima = confirmadoras[0].mercadoPagoOrderId;
      const segunda = legitima === 'ORD-A' ? 'ORD-B' : 'ORD-A';

      const confirmados = await outbox(EVENTO_PAGAMENTO_CONFIRMADO);
      expect(confirmados.map((m) => payloadDe(m).orderId).sort()).toEqual([
        'ORD-A',
        'ORD-B',
      ]);
      expect(mp.chamadasEstorno.map((c) => c.orderId)).toEqual([segunda]);
      expect(await estornoDe(legitima)).toBeNull();
      expect((await estornoDe(segunda))?.situacao).toBe('CONCLUIDO');
      const resultado = await prisma.cobranca.findUniqueOrThrow({
        where: { id: cobranca.cobrancaId },
      });
      expect(resultado.situacao).toBe(SituacaoCobranca.PAGA);
    });

    it('pagamento de order anterior inativa confirma a cobrança com essa order', async () => {
      const cobranca = await criarCobranca(SituacaoCobranca.PENDENTE);
      await criarOrder(cobranca.cobrancaId, 'ORD-A', {
        ativa: false,
        confirmouPagamento: false,
      });
      await criarOrder(cobranca.cobrancaId, 'ORD-B', {
        ativa: true,
        confirmouPagamento: false,
      });
      mp.pagar('ORD-A');

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-A');

      const order = await prisma.orderMercadoPago.findUniqueOrThrow({
        where: { mercadoPagoOrderId: 'ORD-A' },
      });
      expect(order.confirmouPagamento).toBe(true);
      expect(mp.chamadasEstorno).toHaveLength(0);
      expect(
        (await outbox(EVENTO_PAGAMENTO_CONFIRMADO)).map(
          (m) => payloadDe(m).orderId,
        ),
      ).toEqual(['ORD-A']);
    });
  });

  describe('atomicidade do registro', () => {
    it('não deixa registro nem estorno quando a publicação falha, e refaz tudo na repetição', async () => {
      await cenarioCobrancaPagaPorA();
      const falhaNaPublicacao = jest
        .spyOn(nestModule.get<OutboxGateway>(OUTBOX_GATEWAY), 'registrar')
        .mockRejectedValueOnce(new Error('outbox indisponível'));

      await expect(
        conciliar.conciliarPorMercadoPagoOrderId('ORD-B'),
      ).rejects.toThrow('outbox indisponível');

      expect(falhaNaPublicacao).toHaveBeenCalled();
      expect(await prisma.estornoAutomatico.count()).toBe(0);
      expect(mp.chamadasEstorno).toHaveLength(0);

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');

      expect(await prisma.estornoAutomatico.count()).toBe(1);
      expect(await outbox(EVENTO_PAGAMENTO_CONFIRMADO)).toHaveLength(1);
    });
  });

  describe('estorno que não se confirma como integral', () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    async function repetirCiclos(estornoId: string, vezes: number) {
      for (let i = 0; i < vezes; i += 1) {
        await esperarFimDaEspera();
        await executarEstorno.executar(estornoId);
      }
    }

    it('parcial não publica conclusão, repete com a mesma chave e conclui quando integral', async () => {
      await cenarioCobrancaPagaPorA();
      mp.definirModoEstorno('parcial');

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');

      const emAndamento = await estornoDe('ORD-B');
      expect(emAndamento).toMatchObject({ situacao: 'EM_ANDAMENTO' });
      expect(emAndamento?.tentativas).toBe(1);
      expect(await outbox(EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(0);
      expect(await outbox(EVENTO_PAGAMENTO_CONFIRMADO)).toHaveLength(1);

      mp.definirModoEstorno('integral');
      await repetirCiclos(emAndamento?.id as string, 1);

      expect((await estornoDe('ORD-B'))?.situacao).toBe('CONCLUIDO');
      expect(await outbox(EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(1);
      expect(new Set(mp.chamadasEstorno.map((c) => c.chave)).size).toBe(1);
      expect(mp.chamadasEstorno.every((c) => c.orderId === 'ORD-B')).toBe(true);
    });

    it.each(['parcial', 'indeterminado', 'recusado'] as const)(
      'estorno %s até esgotar as tentativas abre pendência manual, sem EstornoConcluido',
      async (modo) => {
        const { cobrancaId, ordemServicoId } = await cenarioCobrancaPagaPorA();
        mp.definirModoEstorno(modo);

        await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');
        const registrado = await estornoDe('ORD-B');
        await repetirCiclos(registrado?.id as string, MAX_TENTATIVAS);

        const final = await estornoDe('ORD-B');
        expect(final?.situacao).toBe('PENDENCIA_MANUAL');
        expect(final?.pendenciaId).not.toBeNull();
        const pendencia = await prisma.pendenciaEstorno.findUniqueOrThrow({
          where: { id: final?.pendenciaId as string },
        });
        expect(pendencia).toMatchObject({
          cobrancaId,
          ordemServicoId,
          situacao: 'ABERTA',
          valorCobrancaCentavos: 25000,
        });
        expect(await outbox(EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(0);
        expect(await outbox(EVENTO_PAGAMENTO_CONFIRMADO)).toHaveLength(1);
        expect(new Set(mp.chamadasEstorno.map((c) => c.chave)).size).toBe(1);
        const sinais = (Logger.prototype.warn as jest.Mock).mock.calls.map(
          ([mensagem]) => JSON.parse(mensagem).metric,
        );
        expect(sinais).toContain('billing.operacao_financeira_indeterminada');
        expect(sinais).toContain('billing.pendencia_estorno_aberta');
      },
    );

    it('consulta indeterminada conta a tentativa, não repete o pedido e nunca conclui', async () => {
      await cenarioCobrancaPagaPorA();
      mp.definirModoEstorno('indeterminado');
      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');
      const registrado = await estornoDe('ORD-B');
      expect(registrado?.tentativas).toBe(1);
      expect(mp.chamadasEstorno).toHaveLength(1);

      mp.definirConsultaIndeterminada(true);
      await repetirCiclos(registrado?.id as string, 1);

      expect(await estornoDe('ORD-B')).toMatchObject({
        situacao: 'EM_ANDAMENTO',
        tentativas: 2,
      });
      expect(mp.chamadasEstorno).toHaveLength(1);
      expect(await outbox(EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(0);
    });

    it('resolver a pendência do segundo pagamento informa a order estornada e preserva a cobrança', async () => {
      const { cobrancaId } = await cenarioCobrancaPagaPorA();
      mp.definirModoEstorno('indeterminado');
      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');
      await repetirCiclos(
        (await estornoDe('ORD-B'))?.id as string,
        MAX_TENTATIVAS,
      );
      const pendenciaId = (await estornoDe('ORD-B'))?.pendenciaId as string;

      await nestModule.get(ResolverPendenciaEstornoUseCase).execute({
        pendenciaId,
        responsavelId: randomUUID(),
        decisao: 'ESTORNO_INTEGRAL',
        justificativa: 'estorno feito no painel',
      });

      const estornos = await outbox(EVENTO_ESTORNO_CONCLUIDO);
      expect(estornos).toHaveLength(1);
      expect(payloadDe(estornos[0])).toMatchObject({
        orderId: 'ORD-B',
        tipoEstorno: 'INTEGRAL',
        origemEstorno: 'PENDENCIA_RESOLVIDA',
      });
      const cobranca = await prisma.cobranca.findUniqueOrThrow({
        where: { id: cobrancaId },
      });
      expect(cobranca.situacao).toBe(SituacaoCobranca.PAGA);
    });
  });

  describe('contrato do EstornoConcluido', () => {
    const exemplo = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '..',
          'docs',
          'contratos',
          'exemplos',
          `${EVENTO_ESTORNO_CONCLUIDO}.json`,
        ),
        'utf-8',
      ),
    ) as { payload: Record<string, unknown> };

    it('a mensagem publicada tem as mesmas chaves e tipos do exemplo, com origemEstorno', async () => {
      await cenarioCobrancaPagaPorA();

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');

      const [mensagem] = await outbox(EVENTO_ESTORNO_CONCLUIDO);
      const publicado = payloadDe(mensagem);
      const tipos = (objeto: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(objeto).map(([k, v]) => [k, typeof v]),
        );
      expect(tipos(publicado)).toEqual(tipos(exemplo.payload));
      expect(exemplo.payload.origemEstorno).toBe('SEGUNDO_PAGAMENTO');
    });
  });
});
