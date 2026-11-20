import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { EVENTO_COBRANCA_EXPIRADA } from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import { ProcessarNotificacaoMercadoPagoUseCase } from '../use-cases/processar-notificacao-mercado-pago.use-case';
import { ConciliarCobrancaService } from './conciliar-cobranca.service';
import { ExpirarCobrancaService } from './expirar-cobranca.service';
import type { RegistrarSegundoPagamentoService } from './registrar-segundo-pagamento.service';
import { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

const criarSegundoPagamentoStub = (): RegistrarSegundoPagamentoService =>
  ({
    orderEhSegundoPagamento: jest.fn().mockResolvedValue(false),
    registrar: jest.fn().mockResolvedValue(null),
    iniciarEstorno: jest.fn(),
  }) as unknown as RegistrarSegundoPagamentoService;

describe('Consistência financeira — E19', () => {
  const prazo = new Date('2099-06-01T00:00:00.000Z');
  const aprovadoNoPrazo = '2099-05-15T12:00:00.000Z';
  const aprovadoTardio = '2099-07-01T12:00:00.000Z';

  const orderAtiva = {
    id: 'loc1',
    mercadoPagoOrderId: 'ORD1',
    chaveIdempotencia: 'chave',
    checkoutUrl: 'https://checkout/1',
    ativa: true,
  };

  it('pagamento no prazo com webhook atrasado usa dateApproved do GET, não o relógio do webhook', async () => {
    const outbox = { registrar: jest.fn() };
    let confirmadoEm: Date | undefined;
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: prazo,
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'https://checkout',
    });
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'processed',
          pagamentos: [
            {
              id: 'PAY1',
              status: 'accredited',
              dateApproved: aprovadoNoPrazo,
            },
          ],
        },
      }),
    };
    const conciliar = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn().mockImplementation(async (_c, _id, c) => {
          confirmadoEm = c.pagamentoConfirmadoEm;
          return c;
        }),
      } as unknown as CobrancaGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderAtiva),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(orderAtiva),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as never,
      outbox as never,
      { executar: jest.fn() } as never,
      new TratarPagamentoTardioService(
        new UnitOfWorkFake(),
        { buscarPorId: jest.fn(), bloquearParaAtualizacao: jest.fn() } as never,
        {} as never,
        {} as never,
      ),
      criarSegundoPagamentoStub(),
    );
    const notificacao = new ProcessarNotificacaoMercadoPagoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(cobranca),
      } as never,
      { registrar: jest.fn() } as never,
      conciliar,
    );
    await notificacao.execute({
      mercadoPagoOrderId: 'ORD1',
      requestId: 'webhook-tardio',
    });
    expect(confirmadoEm?.toISOString()).toBe(
      new Date(aprovadoNoPrazo).toISOString(),
    );
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'billing.pagamento-confirmado.v1' }),
    );
  });

  it('pagamento após o prazo delega tratamento de pagamento tardio', async () => {
    const tratar = {
      tratar: jest.fn(),
      deveTratarPagamentoTardio: jest.fn().mockReturnValue(true),
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'processed',
          pagamentos: [
            {
              id: 'PAY1',
              status: 'accredited',
              dateApproved: aprovadoTardio,
            },
          ],
        },
      }),
    };
    const conciliar = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn().mockImplementation(async (_c, _id, c) => c),
      } as unknown as CobrancaGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderAtiva),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(orderAtiva),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as never,
      { registrar: jest.fn() } as never,
      { executar: jest.fn() } as never,
      tratar as unknown as TratarPagamentoTardioService,
      criarSegundoPagamentoStub(),
    );
    await conciliar.conciliarPorCobrancaId('c1');
    expect(tratar.tratar).toHaveBeenCalled();
  });

  it('expiração sem webhook publica CobrancaExpirada consultando apenas o MP', async () => {
    const outbox = { registrar: jest.fn() };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'https://checkout',
    });
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest
        .fn()
        .mockResolvedValueOnce({
          tipo: 'sucesso',
          order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
        })
        .mockResolvedValueOnce({
          tipo: 'sucesso',
          order: {
            id: 'ORD1',
            status: 'canceled',
            statusDetail: 'expired',
            pagamentos: [],
          },
        }),
      cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
    };
    const expirar = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn().mockResolvedValue(true),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
        marcarConfirmouPagamento: jest.fn(),
        desativar: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as never,
      mercadoPago as never,
      outbox as never,
      new TratarPagamentoTardioService(
        new UnitOfWorkFake(),
        {} as never,
        {} as never,
        {} as never,
      ),
      { conciliarPorCobrancaId: jest.fn() } as never,
    );
    await expirar.expirarPorCobrancaId('c1');
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_COBRANCA_EXPIRADA }),
    );
  });

  it('pagamento detectado após cancelamento na expiração aciona pagamento tardio', async () => {
    const tratar = jest.fn();
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
        }),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: {
            id: 'ORD1',
            status: 'processed',
            pagamentos: [
              {
                id: 'PAY1',
                status: 'accredited',
                dateApproved: aprovadoTardio,
              },
            ],
          },
        }),
      } as never,
      {} as never,
      {
        tratar,
        deveTratarPagamentoTardio: jest.fn().mockReturnValue(true),
      } as never,
      { conciliarPorCobrancaId: jest.fn() } as never,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(tratar).toHaveBeenCalled();
  });
});
