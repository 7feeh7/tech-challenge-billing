import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { EVENTO_COBRANCA_CRIADA } from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '../ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import { ReemitirOrderMercadoPagoService } from './reemitir-order-mercado-pago.service';

describe('ReemitirOrderMercadoPagoService', () => {
  const cobranca = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 10000,
    prazoPagamento: new Date('2099-12-31T00:00:00.000Z'),
    situacao: SituacaoCobranca.PENDENTE,
    linkPagamento: 'https://old',
  });

  it('não reemite quando ainda existe order ativa', async () => {
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn(),
      consultarOrder: jest.fn(),
      cancelarOrder: jest.fn(),
      estornarTotal: jest.fn(),
    };
    const servico = new ReemitirOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn().mockResolvedValue(true),
      } as unknown as CobrancaGateway,
      {
        garantirReemissaoEmAndamento: jest.fn(),
      } as unknown as OperacaoCriacaoOrderGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({ id: 'omp' }),
        buscarUltimaPorCobrancaId: jest.fn(),
        criar: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );

    await servico.executar('c1', null);
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
  });

  it('não reemite com bloqueio de criação ativo', async () => {
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn(),
      consultarOrder: jest.fn(),
      cancelarOrder: jest.fn(),
      estornarTotal: jest.fn(),
    };
    const servico = new ReemitirOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
      } as unknown as CobrancaGateway,
      {} as OperacaoCriacaoOrderGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(true) },
      'comprador@example.com',
    );
    await servico.executar('c1', null);
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
  });

  it('reemite e publica cobrança criada após order expirada', async () => {
    const eventos: string[] = [];
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        orderId: 'ORD2',
        checkoutUrl: 'https://checkout/2',
      }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'canceled',
          pagamentos: [],
        },
      }),
      cancelarOrder: jest.fn(),
      estornarTotal: jest.fn(),
    };
    const servico = new ReemitirOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn().mockResolvedValue(true),
      } as unknown as CobrancaGateway,
      {
        garantirReemissaoEmAndamento: jest
          .fn()
          .mockResolvedValue('chave-reemissao'),
        marcarConcluida: jest.fn(),
      } as unknown as OperacaoCriacaoOrderGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
        buscarUltimaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
        criar: jest.fn().mockResolvedValue({ id: 'omp2' }),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          eventos.push(msg.eventType);
        }),
      },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );

    await servico.executar('c1', null);
    expect(mercadoPago.criarOrder).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'chave-reemissao' }),
    );
    expect(eventos).toContain(EVENTO_COBRANCA_CRIADA);
  });

  it('aborta quando consulta MP é indeterminada', async () => {
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn(),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'indeterminado',
        motivo: 'timeout',
      }),
      cancelarOrder: jest.fn(),
      estornarTotal: jest.fn(),
    };
    const servico = new ReemitirOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
      } as unknown as CobrancaGateway,
      {
        garantirReemissaoEmAndamento: jest
          .fn()
          .mockResolvedValue('chave-reemissao'),
      } as unknown as OperacaoCriacaoOrderGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
        buscarUltimaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );
    await servico.executar('c1', null);
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
  });

  it('não publica quando perde posse de conciliação', async () => {
    const registrar = jest.fn();
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        orderId: 'ORD2',
        checkoutUrl: 'https://checkout/2',
      }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: { id: 'ORD1', status: 'canceled', pagamentos: [] },
      }),
      cancelarOrder: jest.fn(),
      estornarTotal: jest.fn(),
    };
    const posse = new Date('2099-06-01T00:00:00.000Z');
    const servico = new ReemitirOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn().mockResolvedValue(false),
      } as unknown as CobrancaGateway,
      {
        garantirReemissaoEmAndamento: jest
          .fn()
          .mockResolvedValue('chave-reemissao'),
        marcarConcluida: jest.fn(),
      } as unknown as OperacaoCriacaoOrderGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
        buscarUltimaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
        criar: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );
    await servico.executar('c1', posse);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('ignora cobrança fora do prazo', async () => {
    const expirada = new Cobranca({
      ...cobranca,
      prazoPagamento: new Date('2000-01-01T00:00:00.000Z'),
    });
    const mercadoPago = {
      criarOrder: jest.fn(),
    } as unknown as MercadoPagoGateway;
    const servico = new ReemitirOrderMercadoPagoService(
      new UnitOfWorkFake(),
      { buscarPorId: jest.fn().mockResolvedValue(expirada) } as never,
      {} as never,
      {} as never,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'x@y.com',
    );
    await servico.executar('c1', null);
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
  });
});
