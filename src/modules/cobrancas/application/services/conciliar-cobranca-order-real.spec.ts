import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import { FetchMercadoPagoGateway } from '../../infra/http/fetch-mercado-pago.gateway';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import { ConciliarCobrancaService } from './conciliar-cobranca.service';
import { RegistrarSegundoPagamentoService } from './registrar-segundo-pagamento.service';
import { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

// GET real da Orders API (sandbox, E05), sem
// campos sensíveis: o pagamento aprovado vem processed/accredited, sem
// date_approved, e a order só traz created_date e last_updated_date.
const ORDER_PROCESSED_REAL = {
  id: 'ORDTST01M7GMMTFB6C17A37RM207XAST',
  type: 'online',
  processing_mode: 'manual',
  total_amount: '212.00',
  total_paid_amount: '212.00',
  expiration_time: 'PT30M',
  status: 'processed',
  status_detail: 'accredited',
  currency: 'BRL',
  created_date: '2026-11-15T22:18:32.827Z',
  last_updated_date: '2026-11-15T22:28:46.556Z',
  transactions: {
    payments: [
      {
        id: 'PAY01M7GN4JNQ27FGP9YTXRP9TCG6',
        amount: '212',
        status: 'failed',
        status_detail: 'insufficient_amount',
        attempt_number: 1,
      },
      {
        id: 'PAY01M7GN7HTVMPN47J1BW52QB7B7',
        amount: '212',
        paid_amount: '212',
        status: 'processed',
        status_detail: 'accredited',
        attempt_number: 2,
      },
    ],
  },
};

describe('ConciliarCobrancaService com order processed real da Orders API', () => {
  const prazoDepoisDaCriacaoDaOrder = new Date('2026-11-15T22:48:32.827Z');
  const registroDaOrder = {
    id: 'omp1',
    cobrancaId: 'c1',
    mercadoPagoOrderId: ORDER_PROCESSED_REAL.id,
    chaveIdempotencia: 'k1',
    checkoutUrl: 'https://checkout',
    ativa: true,
  };

  let cobranca: Cobranca;
  let orderConfirmouPagamento: boolean;
  let outbox: { registrar: jest.Mock };
  let estornos: { registrarSeNovo: jest.Mock };
  let orders: OrderMercadoPagoGateway;
  let conciliar: ConciliarCobrancaService;

  const criarCobranca = (prazoPagamento: Date) =>
    new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 21200,
      prazoPagamento,
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'https://checkout',
    });

  // O estado da cobrança e da order fica nos fakes, como no banco: a segunda
  // conciliação enxerga o resultado da primeira.
  const montarServico = () => {
    outbox = { registrar: jest.fn() };
    estornos = {
      registrarSeNovo: jest.fn().mockResolvedValue({
        estorno: { id: 'est1', situacao: 'CONCLUIDO' },
        criado: true,
      }),
    };
    const executarEstorno = { executar: jest.fn() };
    orderConfirmouPagamento = false;

    const cobrancas = {
      buscarPorId: jest.fn(async () => cobranca),
      bloquearParaAtualizacao: jest.fn(async () => cobranca),
      buscarPorMercadoPagoOrderId: jest.fn(async () => cobranca),
      atualizar: jest.fn(async (_ctx, _id, atualizada: Cobranca) => {
        cobranca = atualizada;
        return atualizada;
      }),
    } as unknown as CobrancaGateway;
    orders = {
      buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(registroDaOrder),
      buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(registroDaOrder),
      buscarQueConfirmouPagamento: jest.fn(async () =>
        orderConfirmouPagamento ? registroDaOrder : null,
      ),
      marcarConfirmouPagamento: jest.fn(async () => {
        orderConfirmouPagamento = true;
      }),
      atualizarSituacao: jest.fn(),
      desativar: jest.fn(),
    } as unknown as OrderMercadoPagoGateway;

    const mercadoPago = new FetchMercadoPagoGateway({
      get: (chave: string) =>
        chave === 'MP_ACCESS_TOKEN' ? 'token-teste' : undefined,
    } as never);
    const unitOfWork = new UnitOfWorkFake();
    conciliar = new ConciliarCobrancaService(
      unitOfWork,
      cobrancas,
      orders,
      mercadoPago,
      {} as never,
      outbox as never,
      { executar: jest.fn() } as never,
      new TratarPagamentoTardioService(
        unitOfWork,
        cobrancas,
        estornos as never,
        executarEstorno as never,
      ),
      new RegistrarSegundoPagamentoService(
        estornos as never,
        orders,
        outbox as never,
        executarEstorno as never,
      ),
    );
  };

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(ORDER_PROCESSED_REAL),
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('confirma cobrança pendente e publica PagamentoConfirmado para o os-in com order paga dentro do prazo', async () => {
    cobranca = criarCobranca(prazoDepoisDaCriacaoDaOrder);
    montarServico();

    await conciliar.conciliarPorCobrancaId('c1');

    expect(cobranca.situacao).toBe(SituacaoCobranca.PAGA);
    expect(cobranca.pagamentoConfirmadoEm).toEqual(
      new Date('2026-11-15T22:18:32.827Z'),
    );
    expect(orders.marcarConfirmouPagamento).toHaveBeenCalledTimes(1);
    expect(outbox.registrar).toHaveBeenCalledTimes(1);
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'billing.pagamento-confirmado.v1',
        destino: 'os-in',
        envelope: expect.objectContaining({
          payload: expect.objectContaining({
            cobrancaId: 'c1',
            orderId: ORDER_PROCESSED_REAL.id,
            aprovadoEm: '2026-11-15T22:18:32.827Z',
            valorCentavos: 21200,
            origemPagamento: 'PAGAMENTO_LEGITIMO',
          }),
        }),
      }),
    );
    expect(estornos.registrarSeNovo).not.toHaveBeenCalled();
  });

  it('conciliar bem depois do prazo não transforma pagamento em dia em pagamento tardio', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
    cobranca = criarCobranca(prazoDepoisDaCriacaoDaOrder);
    montarServico();

    await conciliar.conciliarPorCobrancaId('c1');

    expect(cobranca.situacao).toBe(SituacaoCobranca.PAGA);
    expect(outbox.registrar).toHaveBeenCalledTimes(1);
    expect(estornos.registrarSeNovo).not.toHaveBeenCalled();
  });

  it('segue o caminho de pagamento tardio quando a order real foi criada depois do prazo', async () => {
    cobranca = criarCobranca(new Date('2026-11-15T22:00:00.000Z'));
    montarServico();

    await conciliar.conciliarPorCobrancaId('c1');

    expect(cobranca.situacao).not.toBe(SituacaoCobranca.PAGA);
    expect(outbox.registrar).not.toHaveBeenCalled();
    expect(orders.marcarConfirmouPagamento).not.toHaveBeenCalled();
    expect(estornos.registrarSeNovo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cobrancaId: 'c1',
        orderMercadoPagoId: 'omp1',
        tipo: 'PAGAMENTO_TARDIO',
        aprovadoEm: new Date('2026-11-15T22:18:32.827Z'),
      }),
    );
  });

  it('conciliação repetida não confirma nem publica de novo', async () => {
    cobranca = criarCobranca(prazoDepoisDaCriacaoDaOrder);
    montarServico();

    await conciliar.conciliarPorCobrancaId('c1');
    await conciliar.conciliarPorCobrancaId('c1');

    expect(cobranca.situacao).toBe(SituacaoCobranca.PAGA);
    expect(outbox.registrar).toHaveBeenCalledTimes(1);
    expect(orders.marcarConfirmouPagamento).toHaveBeenCalledTimes(1);
    expect(estornos.registrarSeNovo).not.toHaveBeenCalled();
  });

  it('webhook seguido de conciliação periódica da mesma order publica uma única vez', async () => {
    cobranca = criarCobranca(prazoDepoisDaCriacaoDaOrder);
    montarServico();

    await conciliar.conciliarPorMercadoPagoOrderId(ORDER_PROCESSED_REAL.id);
    await conciliar.conciliarPorCobrancaId('c1');
    await conciliar.conciliarPorMercadoPagoOrderId(ORDER_PROCESSED_REAL.id);

    expect(cobranca.situacao).toBe(SituacaoCobranca.PAGA);
    expect(outbox.registrar).toHaveBeenCalledTimes(1);
    expect(estornos.registrarSeNovo).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
