import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ExecutarCancelamentoFinanceiroService } from '../src/modules/cancelamento-financeiro/application/services/executar-cancelamento-financeiro.service';
import { ExecutarConsultaSituacaoFinanceiroService } from '../src/modules/cancelamento-financeiro/application/services/executar-consulta-situacao-financeiro.service';
import { ProcessarCancelarFinanceiroUseCase } from '../src/modules/cancelamento-financeiro/application/use-cases/processar-cancelar-financeiro.use-case';
import { ResolverPendenciaEstornoUseCase } from '../src/modules/cancelamento-financeiro/application/use-cases/resolver-pendencia-estorno.use-case';
import { CancelamentoFinanceiroModule } from '../src/modules/cancelamento-financeiro/cancelamento-financeiro.module';
import { ProcessadorOperacoesFinanceirasService } from '../src/modules/cancelamento-financeiro/infra/jobs/processador-operacoes-financeiras.service';
import { MERCADO_PAGO_GATEWAY } from '../src/modules/cobrancas/application/ports/tokens';
import { ConciliarCobrancaService } from '../src/modules/cobrancas/application/services/conciliar-cobranca.service';
import { SituacaoCobranca } from '../src/modules/cobrancas/domain/situacao-cobranca';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import {
  EVENTO_CANCELAR_FINANCEIRO,
  EVENTO_ESTORNO_CONCLUIDO,
  EVENTO_RESPOSTA_CANCELAMENTO,
} from '../src/shared/messaging/envelope';
import { configIntegracaoCobrancas } from './helpers/config-integracao-cobrancas';
import {
  criarDubleMercadoPagoEstorno,
  type DubleMercadoPagoEstorno,
} from './helpers/duble-mercado-pago-estorno';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

const MAX_TENTATIVAS = 3;

describe('Cancelamento financeiro: pendências do complemento (integração)', () => {
  let nestModule: TestingModule;
  let prisma: PrismaService;
  let processar: ProcessarCancelarFinanceiroUseCase;
  let executar: ExecutarCancelamentoFinanceiroService;
  let processador: ProcessadorOperacoesFinanceirasService;
  let conciliar: ConciliarCobrancaService;
  let mp: DubleMercadoPagoEstorno;
  let cancelarOrder: jest.Mock;

  beforeAll(() => {
    exigirDatabaseUrl();
  });

  beforeEach(async () => {
    mp = criarDubleMercadoPagoEstorno();
    cancelarOrder = jest.fn().mockResolvedValue({ tipo: 'sucesso' });
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
        CancelamentoFinanceiroModule,
      ],
    })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue({
        ...mp.gateway,
        cancelarOrder: (orderId: string, chave: string) =>
          cancelarOrder(orderId, chave),
      })
      .compile();

    prisma = nestModule.get(PrismaService);
    processar = nestModule.get(ProcessarCancelarFinanceiroUseCase);
    executar = nestModule.get(ExecutarCancelamentoFinanceiroService);
    processador = nestModule.get(ProcessadorOperacoesFinanceirasService);
    conciliar = nestModule.get(ConciliarCobrancaService, { strict: false });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

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

  afterEach(async () => {
    jest.restoreAllMocks();
    await fecharModuloIntegracao(nestModule);
  });

  async function criarCobrancaComOrder(
    situacao: SituacaoCobranca,
    mercadoPagoOrderId: string,
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
        pagamentoConfirmadoEm: [
          SituacaoCobranca.PAGA,
          SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
        ].includes(situacao)
          ? new Date('2026-11-15T11:00:00.000Z')
          : null,
      },
    });
    await prisma.orderMercadoPago.create({
      data: {
        cobrancaId: cobranca.id,
        mercadoPagoOrderId,
        chaveIdempotencia: randomUUID(),
        checkoutUrl: `https://checkout/${mercadoPagoOrderId}`,
        ativa: true,
        confirmouPagamento: [
          SituacaoCobranca.PAGA,
          SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
        ].includes(situacao),
      },
    });
    return { cobrancaId: cobranca.id, ordemServicoId, correlationId };
  }

  async function solicitarCancelamento(
    cenario: { ordemServicoId: string; correlationId: string },
    resultadoExecucao = 'REPARO_NAO_INICIADO',
  ) {
    const eventId = randomUUID();
    await processar.processar({
      eventId,
      eventType: EVENTO_CANCELAR_FINANCEIRO,
      version: 1,
      occurredAt: new Date().toISOString(),
      source: 'os-service',
      correlationId: cenario.correlationId,
      causationId: null,
      ordemServicoId: cenario.ordemServicoId,
      rodada: 1,
      payload: {
        etapaOrigem: 'CANCELAMENTO_OS',
        motivo: 'Desistência',
        resultadoExecucao,
      },
    } as never);
    return prisma.operacaoFinanceira.findUniqueOrThrow({ where: { eventId } });
  }

  const respostas = async () =>
    (
      await prisma.mensagemOutbox.findMany({
        where: { eventType: EVENTO_RESPOSTA_CANCELAMENTO },
      })
    ).map((m) => (m.envelope as { payload: Record<string, unknown> }).payload);

  const situacaoDa = async (cobrancaId: string) =>
    (await prisma.cobranca.findUniqueOrThrow({ where: { id: cobrancaId } }))
      .situacao;

  async function ciclos(operacaoId: string, vezes: number) {
    for (let i = 0; i < vezes; i += 1) {
      await executar.executar(operacaoId);
    }
  }

  describe('estorno parado em ESTORNO_EM_ANDAMENTO', () => {
    it('com estorno integral já confirmado conclui com ESTORNADA e responde ao OS', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
        'ORD-A',
      );
      mp.pagar('ORD-A');
      mp.definirModoEstorno('integral');
      await mp.gateway.estornarTotal('ORD-A', 'estorno-do-ciclo-anterior');
      mp.chamadasEstorno.length = 0;
      const operacao = await solicitarCancelamento(cenario);

      await ciclos(operacao.id, 1);

      expect(await situacaoDa(cenario.cobrancaId)).toBe(
        SituacaoCobranca.ESTORNADA,
      );
      expect(await respostas()).toEqual([
        { resultado: 'ESTORNADA', pendenciaId: null },
      ]);
      expect(mp.chamadasEstorno).toHaveLength(0);
    });

    it('sem estorno repete o pedido com a mesma chave da operação e responde ESTORNADA', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
        'ORD-A',
      );
      mp.pagar('ORD-A');
      const operacao = await solicitarCancelamento(cenario);

      await ciclos(operacao.id, 1);

      expect(mp.chamadasEstorno).toEqual([
        { orderId: 'ORD-A', chave: operacao.chaveIdempotenciaMercadoPago },
      ]);
      expect(await situacaoDa(cenario.cobrancaId)).toBe(
        SituacaoCobranca.ESTORNADA,
      );
      expect(await respostas()).toEqual([
        { resultado: 'ESTORNADA', pendenciaId: null },
      ]);
    });

    it('estorno indeterminado a cada ciclo repete a mesma chave e, esgotadas as tentativas, abre pendência manual', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.PAGA,
        'ORD-A',
      );
      mp.pagar('ORD-A');
      mp.definirModoEstorno('indeterminado');
      const operacao = await solicitarCancelamento(cenario);

      await ciclos(operacao.id, MAX_TENTATIVAS - 1);

      expect(await situacaoDa(cenario.cobrancaId)).toBe(
        SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
      );
      expect(await respostas()).toHaveLength(0);

      await ciclos(operacao.id, 1);

      const pendencia = await prisma.pendenciaEstorno.findFirstOrThrow({
        where: { cobrancaId: cenario.cobrancaId },
      });
      expect(await situacaoDa(cenario.cobrancaId)).toBe(
        SituacaoCobranca.PENDENCIA_MANUAL,
      );
      expect(await respostas()).toEqual([
        { resultado: 'PENDENCIA_MANUAL_ABERTA', pendenciaId: pendencia.id },
      ]);
      expect(new Set(mp.chamadasEstorno.map((c) => c.chave))).toEqual(
        new Set([operacao.chaveIdempotenciaMercadoPago]),
      );
      const sinais = (Logger.prototype.warn as jest.Mock).mock.calls.map(
        ([mensagem]) => JSON.parse(mensagem).metric,
      );
      expect(sinais).toContain('billing.operacao_financeira_indeterminada');
      const concluida = await prisma.operacaoFinanceira.findUniqueOrThrow({
        where: { id: operacao.id },
      });
      expect(concluida.situacao).toBe('CONCLUIDA');
    });

    it('o estorno confirmado depois de um ciclo indeterminado conclui sem abrir pendência', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.PAGA,
        'ORD-A',
      );
      mp.pagar('ORD-A');
      mp.definirModoEstorno('indeterminado');
      const operacao = await solicitarCancelamento(cenario);
      await ciclos(operacao.id, 1);

      mp.definirModoEstorno('integral');
      await ciclos(operacao.id, 1);

      expect(await situacaoDa(cenario.cobrancaId)).toBe(
        SituacaoCobranca.ESTORNADA,
      );
      expect(await prisma.pendenciaEstorno.count()).toBe(0);
      expect(await respostas()).toEqual([
        { resultado: 'ESTORNADA', pendenciaId: null },
      ]);
    });
  });

  describe('pendência manual de cobrança ainda sem pagamento confirmado', () => {
    beforeEach(() => {
      cancelarOrder.mockResolvedValue({
        tipo: 'conflito_especifico',
        codigo: 'cannot_cancel_order',
      });
    });

    it.each([SituacaoCobranca.PENDENTE, SituacaoCobranca.EXPIRADA])(
      'cobrança %s com order ativa e pagamento revelado abre a pendência sem erro e responde ao OS',
      async (situacao) => {
        const cenario = await criarCobrancaComOrder(situacao, 'ORD-A');
        mp.pagar('ORD-A', '2026-11-15T12:00:00.000Z');
        const operacao = await solicitarCancelamento(cenario);

        await ciclos(operacao.id, MAX_TENTATIVAS);

        const cobranca = await prisma.cobranca.findUniqueOrThrow({
          where: { id: cenario.cobrancaId },
        });
        expect(cobranca.situacao).toBe(SituacaoCobranca.PENDENCIA_MANUAL);
        expect(cobranca.pagamentoConfirmadoEm?.toISOString()).toBe(
          '2026-11-15T12:00:00.000Z',
        );
        const order = await prisma.orderMercadoPago.findUniqueOrThrow({
          where: { mercadoPagoOrderId: 'ORD-A' },
        });
        expect(order.confirmouPagamento).toBe(true);
        const pendencia = await prisma.pendenciaEstorno.findFirstOrThrow({
          where: { cobrancaId: cenario.cobrancaId },
        });
        expect(await respostas()).toEqual([
          { resultado: 'PENDENCIA_MANUAL_ABERTA', pendenciaId: pendencia.id },
        ]);
        expect(mp.chamadasEstorno).toHaveLength(0);
      },
    );
  });

  describe('isolamento do lote', () => {
    it('uma operação que falha não impede as demais, continua em andamento e responde ao OS na nova tentativa', async () => {
      const falha = await criarCobrancaComOrder(
        SituacaoCobranca.PENDENTE,
        'ORD-FALHA',
      );
      const normal = await criarCobrancaComOrder(
        SituacaoCobranca.PENDENTE,
        'ORD-NORMAL',
      );
      mp.encerrarSemPagamento('ORD-FALHA');
      mp.encerrarSemPagamento('ORD-NORMAL');
      cancelarOrder.mockImplementation(async (orderId: string) => {
        if (orderId === 'ORD-FALHA') throw new Error('falha inesperada');
        return { tipo: 'sucesso' };
      });
      const opFalha = await solicitarCancelamento(falha);
      const opNormal = await solicitarCancelamento(normal);
      // A operação que falha é a primeira do lote: a seguinte só conclui se a falha for isolada.
      await prisma.operacaoFinanceira.update({
        where: { id: opFalha.id },
        data: { criadoEm: new Date('2020-01-01T00:00:00.000Z') },
      });

      await processador.processarLote();

      const depoisFalha = await prisma.operacaoFinanceira.findUniqueOrThrow({
        where: { id: opFalha.id },
      });
      expect(depoisFalha.situacao).toBe('EM_ANDAMENTO');
      expect(depoisFalha.bloqueadoProcessamentoAte?.getTime()).toBeGreaterThan(
        Date.now() - 1000,
      );
      const depoisNormal = await prisma.operacaoFinanceira.findUniqueOrThrow({
        where: { id: opNormal.id },
      });
      expect(depoisNormal).toMatchObject({
        situacao: 'CONCLUIDA',
        resultado: 'CANCELADA',
      });
      expect(await respostas()).toEqual([
        { resultado: 'CANCELADA', pendenciaId: null },
      ]);
      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
      const [mensagem] = (Logger.prototype.error as jest.Mock).mock.calls[0];
      expect(JSON.parse(mensagem)).toMatchObject({
        evento: 'falha_item_lote',
        itemId: opFalha.id,
        erro: 'Error',
      });

      cancelarOrder.mockResolvedValue({ tipo: 'sucesso' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await processador.processarLote();

      const depois = await prisma.operacaoFinanceira.findUniqueOrThrow({
        where: { id: opFalha.id },
      });
      expect(depois).toMatchObject({
        situacao: 'CONCLUIDA',
        resultado: 'CANCELADA',
      });
      expect(await respostas()).toHaveLength(2);
    });

    it('um estorno automático com falha não impede o processamento do seguinte', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.PAGA,
        'ORD-A',
      );
      await prisma.orderMercadoPago.create({
        data: {
          cobrancaId: cenario.cobrancaId,
          mercadoPagoOrderId: 'ORD-B',
          chaveIdempotencia: randomUUID(),
          checkoutUrl: 'https://checkout/ORD-B',
          ativa: false,
        },
      });
      mp.pagar('ORD-A');
      mp.pagar('ORD-B');
      mp.definirModoEstorno('indeterminado');
      await conciliar.conciliarPorMercadoPagoOrderId('ORD-B');
      const registrado = await prisma.estornoAutomatico.findFirstOrThrow();
      expect(registrado.situacao).toBe('EM_ANDAMENTO');

      mp.definirModoEstorno('integral');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await processador.processarLote();

      const final = await prisma.estornoAutomatico.findUniqueOrThrow({
        where: { id: registrado.id },
      });
      expect(final.situacao).toBe('CONCLUIDO');
      const estornos = await prisma.mensagemOutbox.findMany({
        where: { eventType: EVENTO_ESTORNO_CONCLUIDO },
      });
      expect(estornos).toHaveLength(1);
      expect(
        mp.chamadasEstorno.filter((c) => c.orderId === 'ORD-A'),
      ).toHaveLength(0);
    });
  });

  describe('cancelamento concorrente com estorno automático em curso', () => {
    async function criarEstornoAutomatico(
      cobrancaId: string,
      mercadoPagoOrderId: string,
    ) {
      const order = await prisma.orderMercadoPago.findUniqueOrThrow({
        where: { mercadoPagoOrderId },
      });
      return prisma.estornoAutomatico.create({
        data: {
          cobrancaId,
          orderMercadoPagoId: order.id,
          tipo: 'PAGAMENTO_TARDIO',
          chaveIdempotencia: randomUUID(),
          valorCentavos: 25000,
          aprovadoEm: new Date('2026-11-15T12:00:00.000Z'),
        },
      });
    }

    const tardias = () =>
      prisma.mensagemOutbox.findMany({
        where: { eventType: 'billing.pagamento-tardio-registrado.v1' },
      });

    it.each([SituacaoCobranca.EXPIRADA, SituacaoCobranca.PENDENTE])(
      'cobrança %s: o cancelamento espera o estorno, sem pendência duplicada nem segundo estorno',
      async (situacao) => {
        const cenario = await criarCobrancaComOrder(situacao, 'ORD-TARDIA');
        mp.pagar('ORD-TARDIA');
        await criarEstornoAutomatico(cenario.cobrancaId, 'ORD-TARDIA');
        const operacao = await solicitarCancelamento(cenario);

        await Promise.all([
          executar.executar(operacao.id),
          processador.processarLote(),
        ]);
        await executar.executar(operacao.id);

        const order = await prisma.orderMercadoPago.findUniqueOrThrow({
          where: { mercadoPagoOrderId: 'ORD-TARDIA' },
        });
        expect(order.confirmouPagamento).toBe(false);
        expect(await prisma.pendenciaEstorno.count()).toBe(0);
        expect(mp.chamadasEstorno).toHaveLength(1);
        expect(cancelarOrder).not.toHaveBeenCalled();
        expect(await tardias()).toHaveLength(1);
        expect(await respostas()).toEqual([
          { resultado: 'CANCELADA', pendenciaId: null },
        ]);
        expect(await situacaoDa(cenario.cobrancaId)).not.toBe(
          SituacaoCobranca.PENDENCIA_MANUAL,
        );
      },
    );

    it('estorno em andamento mantém a operação em andamento até o desfecho', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.EXPIRADA,
        'ORD-TARDIA',
      );
      mp.pagar('ORD-TARDIA');
      await criarEstornoAutomatico(cenario.cobrancaId, 'ORD-TARDIA');
      const operacao = await solicitarCancelamento(cenario);

      await ciclos(operacao.id, 1);

      const depois = await prisma.operacaoFinanceira.findUniqueOrThrow({
        where: { id: operacao.id },
      });
      expect(depois.situacao).toBe('EM_ANDAMENTO');
      expect(depois.tentativasMercadoPago).toBe(0);
      expect(await respostas()).toHaveLength(0);
    });

    it('estorno que esgotou as tentativas: a operação responde com a pendência do estorno, sem abrir outra', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.EXPIRADA,
        'ORD-TARDIA',
      );
      mp.pagar('ORD-TARDIA');
      mp.definirModoEstorno('indeterminado');
      const estorno = await criarEstornoAutomatico(
        cenario.cobrancaId,
        'ORD-TARDIA',
      );
      const operacao = await solicitarCancelamento(cenario);
      for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await processador.processarLote();
      }
      const final = await prisma.estornoAutomatico.findUniqueOrThrow({
        where: { id: estorno.id },
      });
      expect(final.situacao).toBe('PENDENCIA_MANUAL');

      await ciclos(operacao.id, 1);

      expect(await prisma.pendenciaEstorno.count()).toBe(1);
      expect(await respostas()).toEqual([
        {
          resultado: 'PENDENCIA_MANUAL_ABERTA',
          pendenciaId: final.pendenciaId,
        },
      ]);
      const order = await prisma.orderMercadoPago.findUniqueOrThrow({
        where: { mercadoPagoOrderId: 'ORD-TARDIA' },
      });
      expect(order.confirmouPagamento).toBe(false);
    });
  });

  describe('pendência do estorno automático já resolvida', () => {
    it.each(['ESTORNO_INTEGRAL', 'SEM_ESTORNO'] as const)(
      'decisão %s: o cancelamento segue o fluxo normal, sem segundo estorno nem pendência nova',
      async (decisao) => {
        const cenario = await criarCobrancaComOrder(
          SituacaoCobranca.EXPIRADA,
          'ORD-TARDIA',
        );
        mp.pagar('ORD-TARDIA');
        mp.definirModoEstorno('indeterminado');
        const order = await prisma.orderMercadoPago.findUniqueOrThrow({
          where: { mercadoPagoOrderId: 'ORD-TARDIA' },
        });
        const estorno = await prisma.estornoAutomatico.create({
          data: {
            cobrancaId: cenario.cobrancaId,
            orderMercadoPagoId: order.id,
            tipo: 'PAGAMENTO_TARDIO',
            chaveIdempotencia: randomUUID(),
            valorCentavos: 25000,
            aprovadoEm: new Date('2026-11-15T12:00:00.000Z'),
          },
        });
        for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          await processador.processarLote();
        }
        const emPendencia = await prisma.estornoAutomatico.findUniqueOrThrow({
          where: { id: estorno.id },
        });
        expect(emPendencia.situacao).toBe('PENDENCIA_MANUAL');
        await nestModule.get(ResolverPendenciaEstornoUseCase).execute({
          pendenciaId: emPendencia.pendenciaId as string,
          responsavelId: randomUUID(),
          decisao,
          justificativa: 'resolvido no painel',
        });
        const estornosAntes = mp.chamadasEstorno.length;
        const operacao = await solicitarCancelamento(cenario);

        await ciclos(operacao.id, 1);

        expect(mp.chamadasEstorno).toHaveLength(estornosAntes);
        expect(await prisma.pendenciaEstorno.count()).toBe(1);
        expect(await respostas()).toEqual([
          { resultado: 'CANCELADA', pendenciaId: null },
        ]);
        const depois = await prisma.orderMercadoPago.findUniqueOrThrow({
          where: { mercadoPagoOrderId: 'ORD-TARDIA' },
        });
        expect(depois.ativa).toBe(false);
      },
    );
  });

  describe('cobrança sem pagamento confirmado e sem pagamento revelado', () => {
    beforeEach(() => {
      cancelarOrder.mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' });
      mp.definirConsultaIndeterminada(true);
    });

    const pendenciaDaCobranca = (cobrancaId: string) =>
      prisma.pendenciaEstorno.findFirstOrThrow({ where: { cobrancaId } });

    it.each([
      SituacaoCobranca.INTENCAO,
      SituacaoCobranca.PENDENTE,
      SituacaoCobranca.EXPIRADA,
    ])(
      'cobrança %s: abre a pendência, responde ao OS e mantém a situação',
      async (situacao) => {
        const cenario = await criarCobrancaComOrder(situacao, 'ORD-A');
        const operacao = await solicitarCancelamento(cenario);

        await ciclos(operacao.id, MAX_TENTATIVAS);
        // Reprocesso depois da conclusão não abre outra pendência nem responde de novo.
        await ciclos(operacao.id, 1);

        expect(await situacaoDa(cenario.cobrancaId)).toBe(situacao);
        const pendencia = await pendenciaDaCobranca(cenario.cobrancaId);
        expect(await prisma.pendenciaEstorno.count()).toBe(1);
        expect(await respostas()).toEqual([
          { resultado: 'PENDENCIA_MANUAL_ABERTA', pendenciaId: pendencia.id },
        ]);
      },
    );

    it.each([SituacaoCobranca.PENDENTE, SituacaoCobranca.EXPIRADA])(
      'reprocesso que revela o pagamento (%s) reaproveita a pendência aberta, sem abrir outra',
      async (situacao) => {
        const cenario = await criarCobrancaComOrder(situacao, 'ORD-A');
        const operacao = await solicitarCancelamento(cenario);
        await ciclos(operacao.id, MAX_TENTATIVAS);
        const primeira = await pendenciaDaCobranca(cenario.cobrancaId);
        // A conclusão da operação falhou depois de a pendência ser aberta.
        await prisma.mensagemOutbox.deleteMany({
          where: { eventType: EVENTO_RESPOSTA_CANCELAMENTO },
        });
        await prisma.operacaoFinanceira.update({
          where: { id: operacao.id },
          data: {
            situacao: 'EM_ANDAMENTO',
            resultado: null,
            pendenciaId: null,
          },
        });
        mp.definirConsultaIndeterminada(false);
        mp.pagar('ORD-A', '2026-11-15T12:00:00.000Z');

        await ciclos(operacao.id, 1);

        expect(await prisma.pendenciaEstorno.count()).toBe(1);
        const cobranca = await prisma.cobranca.findUniqueOrThrow({
          where: { id: cenario.cobrancaId },
        });
        expect(cobranca.situacao).toBe(SituacaoCobranca.PENDENCIA_MANUAL);
        expect(cobranca.pagamentoConfirmadoEm?.toISOString()).toBe(
          '2026-11-15T12:00:00.000Z',
        );
        const order = await prisma.orderMercadoPago.findUniqueOrThrow({
          where: { mercadoPagoOrderId: 'ORD-A' },
        });
        expect(order.confirmouPagamento).toBe(true);
        expect(await respostas()).toEqual([
          { resultado: 'PENDENCIA_MANUAL_ABERTA', pendenciaId: primeira.id },
        ]);
      },
    );

    it('pagamento real posterior dentro do prazo não é perdido: confirma a cobrança e publica PagamentoConfirmado', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.PENDENTE,
        'ORD-A',
      );
      const operacao = await solicitarCancelamento(cenario);
      await ciclos(operacao.id, MAX_TENTATIVAS);
      mp.definirConsultaIndeterminada(false);
      mp.pagar('ORD-A', '2026-11-15T12:00:00.000Z');

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-A');

      expect(await situacaoDa(cenario.cobrancaId)).toBe(SituacaoCobranca.PAGA);
      const confirmados = await prisma.mensagemOutbox.findMany({
        where: { eventType: 'billing.pagamento-confirmado.v1' },
      });
      expect(confirmados).toHaveLength(1);
      expect(mp.chamadasEstorno).toHaveLength(0);
    });

    it('pagamento real posterior numa cobrança expirada é estornado como tardio, com PagamentoTardioRegistrado', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.EXPIRADA,
        'ORD-A',
      );
      const operacao = await solicitarCancelamento(cenario);
      await ciclos(operacao.id, MAX_TENTATIVAS);
      mp.definirConsultaIndeterminada(false);
      mp.pagar('ORD-A');

      await conciliar.conciliarPorMercadoPagoOrderId('ORD-A');

      const tardias = await prisma.mensagemOutbox.findMany({
        where: { eventType: 'billing.pagamento-tardio-registrado.v1' },
      });
      expect(tardias).toHaveLength(1);
      expect(mp.chamadasEstorno.map((c) => c.orderId)).toEqual(['ORD-A']);
    });

    it('outra order paga depois não é estornada como segundo pagamento nem a pendência estorna dinheiro que não entrou', async () => {
      const cenario = await criarCobrancaComOrder(
        SituacaoCobranca.PENDENTE,
        'ORD-A',
      );
      const operacao = await solicitarCancelamento(cenario);
      await ciclos(operacao.id, MAX_TENTATIVAS);
      const pendencia = await pendenciaDaCobranca(cenario.cobrancaId);

      await expect(
        nestModule.get(ResolverPendenciaEstornoUseCase).execute({
          pendenciaId: pendencia.id,
          responsavelId: randomUUID(),
          decisao: 'ESTORNO_INTEGRAL',
        }),
      ).rejects.toThrow('não tem pagamento confirmado');

      expect(await prisma.estornoAutomatico.count()).toBe(0);
      expect(
        await prisma.mensagemOutbox.count({
          where: { eventType: EVENTO_ESTORNO_CONCLUIDO },
        }),
      ).toBe(0);
      const aberta = await prisma.pendenciaEstorno.findUniqueOrThrow({
        where: { id: pendencia.id },
      });
      expect(aberta.situacao).toBe('ABERTA');
    });
  });

  describe('consulta de situação financeira com segundo pagamento', () => {
    async function solicitarConsulta(
      cenario: { ordemServicoId: string; correlationId: string },
      finalidade: 'EXCECAO_E10' | 'PRAZO_DE_REFERENCIA_VENCIDO',
    ) {
      return prisma.operacaoFinanceira.create({
        data: {
          eventId: randomUUID(),
          ordemServicoId: cenario.ordemServicoId,
          rodada: 1,
          correlationId: cenario.correlationId,
          tipo: 'CONSULTA_SITUACAO_FINANCEIRA',
          chaveIdempotenciaMercadoPago: randomUUID(),
          consultaId: randomUUID(),
          finalidadeConsulta: finalidade,
        },
      });
    }

    it.each([
      SituacaoCobranca.PENDENCIA_MANUAL,
      SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
    ])(
      'cobrança %s com segunda order paga e não conciliada: responde com a order legítima',
      async (situacao) => {
        const cenario = await criarCobrancaComOrder(situacao, 'ORD-O1');
        await prisma.cobranca.update({
          where: { id: cenario.cobrancaId },
          data: { pagamentoConfirmadoEm: new Date('2026-11-15T11:00:00.000Z') },
        });
        await prisma.orderMercadoPago.update({
          where: { mercadoPagoOrderId: 'ORD-O1' },
          data: { ativa: false, confirmouPagamento: true },
        });
        await prisma.orderMercadoPago.create({
          data: {
            cobrancaId: cenario.cobrancaId,
            mercadoPagoOrderId: 'ORD-O2',
            chaveIdempotencia: randomUUID(),
            checkoutUrl: 'https://checkout/ORD-O2',
            ativa: true,
          },
        });
        mp.pagar('ORD-O1', '2026-11-15T11:00:00.000Z');
        mp.pagar('ORD-O2', '2026-11-15T12:00:00.000Z');
        const operacao = await solicitarConsulta(
          cenario,
          'PRAZO_DE_REFERENCIA_VENCIDO',
        );
        mp.chamadasConsulta.length = 0;

        await nestModule
          .get(ExecutarConsultaSituacaoFinanceiroService)
          .executar(operacao.id);

        expect(mp.chamadasConsulta).toEqual(['ORD-O1']);
        expect(cancelarOrder).not.toHaveBeenCalled();
        const [resposta] = await prisma.mensagemOutbox.findMany({
          where: { eventType: 'billing.situacao-financeira.v1' },
        });
        expect(
          (resposta.envelope as { payload: Record<string, unknown> }).payload,
        ).toMatchObject({
          situacaoPagamento: 'PAGO_NO_PRAZO',
          orderId: 'ORD-O1',
          aprovadoEm: '2026-11-15T11:00:00.000Z',
        });
      },
    );

    it.each(['EXCECAO_E10', 'PRAZO_DE_REFERENCIA_VENCIDO'] as const)(
      'reemissão com duas orders pagas (%s): responde com a order legítima',
      async (finalidade) => {
        const cenario = await criarCobrancaComOrder(
          SituacaoCobranca.PENDENTE,
          'ORD-O1',
        );
        await prisma.orderMercadoPago.update({
          where: { mercadoPagoOrderId: 'ORD-O1' },
          data: { ativa: false },
        });
        await prisma.orderMercadoPago.create({
          data: {
            cobrancaId: cenario.cobrancaId,
            mercadoPagoOrderId: 'ORD-O2',
            chaveIdempotencia: randomUUID(),
            checkoutUrl: 'https://checkout/ORD-O2',
            ativa: true,
          },
        });
        mp.pagar('ORD-O1', '2026-11-15T11:00:00.000Z');
        mp.pagar('ORD-O2', '2026-11-15T12:00:00.000Z');
        await conciliar.conciliarPorMercadoPagoOrderId('ORD-O1');
        await conciliar.conciliarPorMercadoPagoOrderId('ORD-O2');
        const operacao = await solicitarConsulta(cenario, finalidade);
        mp.chamadasConsulta.length = 0;

        await nestModule
          .get(ExecutarConsultaSituacaoFinanceiroService)
          .executar(operacao.id);

        expect(mp.chamadasConsulta).toEqual(['ORD-O1']);
        const [resposta] = await prisma.mensagemOutbox.findMany({
          where: { eventType: 'billing.situacao-financeira.v1' },
        });
        expect(
          (resposta.envelope as { payload: Record<string, unknown> }).payload,
        ).toMatchObject({
          situacaoPagamento: 'PAGO_NO_PRAZO',
          orderId: 'ORD-O1',
          aprovadoEm: '2026-11-15T11:00:00.000Z',
          cobrancaId: cenario.cobrancaId,
        });
      },
    );
  });
});
