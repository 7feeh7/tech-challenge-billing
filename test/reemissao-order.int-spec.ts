import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { MercadoPagoGateway } from '../src/modules/cobrancas/application/ports/mercado-pago.gateway';
import { MERCADO_PAGO_GATEWAY } from '../src/modules/cobrancas/application/ports/tokens';
import { ReemitirOrderMercadoPagoService } from '../src/modules/cobrancas/application/services/reemitir-order-mercado-pago.service';
import { CobrancasModule } from '../src/modules/cobrancas/cobrancas.module';
import { SituacaoCobranca } from '../src/modules/cobrancas/domain/situacao-cobranca';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { configIntegracaoCobrancas } from './helpers/config-integracao-cobrancas';
import {
  criarDublêMercadoPagoReemissao,
  criarDublêMercadoPagoReemissaoSucesso,
} from './helpers/dublê-mercado-pago-reemissao';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

describe('Reemissão de order (integração)', () => {
  let prisma: PrismaService;
  let dublê: ReturnType<typeof criarDublêMercadoPagoReemissao>;
  let modulosEncerrar: TestingModule[] = [];

  beforeAll(() => {
    exigirDatabaseUrl();
  });

  afterEach(async () => {
    for (const modulo of modulosEncerrar) {
      await fecharModuloIntegracao(modulo);
    }
    modulosEncerrar = [];
  });

  async function criarInstanciaBilling(
    mercadoPago: MercadoPagoGateway,
  ): Promise<{
    module: TestingModule;
    reemitir: ReemitirOrderMercadoPagoService;
    prisma: PrismaService;
  }> {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configIntegracaoCobrancas],
        }),
        PrismaModule,
        CobrancasModule,
      ],
    })
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue(mercadoPago)
      .compile();

    modulosEncerrar.push(module);

    return {
      module,
      reemitir: module.get(ReemitirOrderMercadoPagoService),
      prisma: module.get(PrismaService),
    };
  }

  async function limparBanco(instanciaPrisma: PrismaService) {
    await instanciaPrisma.tentativaPagamentoRecusada.deleteMany();
    await instanciaPrisma.orderMercadoPago.deleteMany();
    await instanciaPrisma.operacaoCriacaoOrder.deleteMany();
    await instanciaPrisma.cobranca.deleteMany();
    await instanciaPrisma.orcamentoItem.deleteMany();
    await instanciaPrisma.orcamento.deleteMany();
    await instanciaPrisma.mensagemOutbox.deleteMany();
  }

  async function seedCobrancaPendente(instanciaPrisma: PrismaService) {
    const orcamentoId = randomUUID();
    const cobrancaId = randomUUID();
    const chaveAntiga = randomUUID();

    const ordemServicoId = randomUUID();
    await instanciaPrisma.orcamento.create({
      data: {
        id: orcamentoId,
        ordemServicoId,
        rodada: 1,
        clienteId: randomUUID(),
        correlationId: randomUUID(),
        valorTotalCentavos: 15000,
        situacao: 'APROVADO',
        prazoReferencia: new Date('2099-12-31T00:00:00.000Z'),
      },
    });

    await instanciaPrisma.cobranca.create({
      data: {
        id: cobrancaId,
        orcamentoId,
        ordemServicoId,
        rodada: 1,
        clienteId: randomUUID(),
        correlationId: randomUUID(),
        valorTotalCentavos: 15000,
        prazoPagamento: new Date('2099-06-01T00:00:00.000Z'),
        situacao: SituacaoCobranca.PENDENTE,
        linkPagamento: 'https://checkout/antigo',
      },
    });

    await instanciaPrisma.orderMercadoPago.create({
      data: {
        id: randomUUID(),
        cobrancaId,
        mercadoPagoOrderId: 'ORD-PREV',
        chaveIdempotencia: chaveAntiga,
        checkoutUrl: 'https://checkout/antigo',
        ativa: false,
        statusOrder: 'canceled',
        statusDetail: 'expired',
      },
    });

    await instanciaPrisma.operacaoCriacaoOrder.create({
      data: {
        id: randomUUID(),
        cobrancaId,
        chaveIdempotencia: randomUUID(),
        situacao: 'CONCLUIDA',
      },
    });

    return cobrancaId;
  }

  it('concorrência entre duas instâncias Billing cria no máximo uma order apta a pagamento', async () => {
    dublê = criarDublêMercadoPagoReemissaoSucesso();
    const instanciaA = await criarInstanciaBilling(dublê.gateway);
    const instanciaB = await criarInstanciaBilling(dublê.gateway);
    prisma = instanciaA.prisma;
    await limparBanco(prisma);

    const cobrancaId = await seedCobrancaPendente(prisma);

    await Promise.allSettled([
      instanciaA.reemitir.executar(cobrancaId, null),
      instanciaB.reemitir.executar(cobrancaId, null),
    ]);

    const ativas = await prisma.orderMercadoPago.findMany({
      where: { cobrancaId, ativa: true },
    });
    expect(ativas).toHaveLength(1);

    const totalAtivas = await prisma.orderMercadoPago.count({
      where: { cobrancaId, ativa: true },
    });
    expect(totalAtivas).toBe(1);
    expect(dublê.ordensCriadasNoDublê.length).toBeGreaterThanOrEqual(1);

    for (const orderId of dublê.ordensCriadasNoDublê) {
      const local = await prisma.orderMercadoPago.findFirst({
        where: { mercadoPagoOrderId: orderId },
      });
      expect(local).toBeTruthy();
    }
  });

  it('timeout após criar order no dublê: segunda instância recupera com mesma chave e sem órfãs', async () => {
    dublê = criarDublêMercadoPagoReemissao();
    const instanciaA = await criarInstanciaBilling(dublê.gateway);
    const instanciaB = await criarInstanciaBilling(dublê.gateway);
    prisma = instanciaA.prisma;
    await limparBanco(prisma);

    const cobrancaId = await seedCobrancaPendente(prisma);
    const chavePersistida = randomUUID();

    await prisma.operacaoCriacaoOrder.update({
      where: { cobrancaId },
      data: {
        chaveIdempotencia: chavePersistida,
        situacao: 'EM_ANDAMENTO',
      },
    });

    await instanciaA.reemitir.executar(cobrancaId, null);

    const operacaoAposTimeout = await prisma.operacaoCriacaoOrder.findUnique({
      where: { cobrancaId },
    });
    expect(operacaoAposTimeout?.situacao).toBe('EM_ANDAMENTO');
    expect(operacaoAposTimeout?.chaveIdempotencia).toBe(chavePersistida);
    expect(dublê.ordensCriadasNoDublê).toHaveLength(1);
    expect(
      await prisma.orderMercadoPago.count({
        where: { cobrancaId, ativa: true },
      }),
    ).toBe(0);

    await instanciaB.reemitir.executar(cobrancaId, null);

    const operacao = await prisma.operacaoCriacaoOrder.findUnique({
      where: { cobrancaId },
    });
    expect(operacao?.chaveIdempotencia).toBe(chavePersistida);
    expect(operacao?.situacao).toBe('CONCLUIDA');

    const orderId = dublê.ordemPorChave.get(chavePersistida)?.orderId;
    expect(orderId).toBeDefined();

    const orderLocal = await prisma.orderMercadoPago.findFirst({
      where: { mercadoPagoOrderId: orderId },
    });
    expect(orderLocal?.ativa).toBe(true);

    for (const idMp of dublê.ordensCriadasNoDublê) {
      const registro = await prisma.orderMercadoPago.findFirst({
        where: { mercadoPagoOrderId: idMp },
      });
      expect(registro).toBeTruthy();
    }

    expect(
      await prisma.orderMercadoPago.count({
        where: { cobrancaId, ativa: true },
      }),
    ).toBe(1);

    expect(
      dublê.chamadasCriarOrder.every(
        (c) => c.idempotencyKey === chavePersistida,
      ),
    ).toBe(true);
  });
});
