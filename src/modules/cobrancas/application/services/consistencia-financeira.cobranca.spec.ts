import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { AvisoWebhookGateway } from '../ports/aviso-webhook.gateway';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '../ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import type { TentativaRecusaGateway } from '../ports/tentativa-recusa.gateway';
import { ProcessarNotificacaoMercadoPagoUseCase } from '../use-cases/processar-notificacao-mercado-pago.use-case';
import { ConciliarCobrancaService } from './conciliar-cobranca.service';
import type { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

const criarPagamentoTardioStub = (): TratarPagamentoTardioService =>
  ({
    deveTratarPagamentoTardio: jest.fn().mockReturnValue(false),
    tratar: jest.fn(),
  }) as unknown as TratarPagamentoTardioService;

import { CriarOrderMercadoPagoService } from './criar-order-mercado-pago.service';

describe('Consistência financeira — cobrança (E17)', () => {
  const prazoOriginal = new Date('2099-06-01T00:00:00.000Z');
  const cobrancaPendente = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl',
    correlationId: 'corr',
    valorTotalCentavos: 10000,
    prazoPagamento: prazoOriginal,
    situacao: SituacaoCobranca.PENDENTE,
    linkPagamento: 'https://checkout/original',
  });

  const order = {
    id: 'omp1',
    cobrancaId: 'c1',
    mercadoPagoOrderId: 'ORD1',
    chaveIdempotencia: 'k1',
    checkoutUrl: 'https://checkout/original',
    ativa: true,
  };

  it('timeout na Orders API: nova tentativa reutiliza chave persistida', async () => {
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest
        .fn()
        .mockResolvedValueOnce({
          tipo: 'indeterminado',
          motivo: 'TimeoutError',
        })
        .mockResolvedValueOnce({
          tipo: 'sucesso',
          orderId: 'ORD1',
          checkoutUrl: 'https://checkout/1',
        }),
      consultarOrder: jest.fn(),
    };
    let chavePersistida: string | undefined;
    const operacoes: OperacaoCriacaoOrderGateway = {
      obterPorCobrancaId: jest.fn().mockImplementation(async () =>
        chavePersistida
          ? {
              cobrancaId: 'c1',
              chaveIdempotencia: chavePersistida,
              situacao: 'EM_ANDAMENTO',
            }
          : null,
      ),
      garantirEmAndamento: jest
        .fn()
        .mockImplementation(async (_ctx, _id, chave) => {
          chavePersistida = chave;
          return {
            cobrancaId: 'c1',
            chaveIdempotencia: chave,
            situacao: 'EM_ANDAMENTO',
          };
        }),
      marcarConcluida: jest.fn(),
    };
    const intencao = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.INTENCAO,
      linkPagamento: null,
    });
    const servico = new CriarOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(intencao),
        atualizar: jest.fn().mockImplementation(async (_c, _id, c) => c),
      } as unknown as CobrancaGateway,
      operacoes,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
        criar: jest.fn().mockResolvedValue({ id: 'omp1' }),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );
    await servico.executar('c1');
    await servico.executar('c1');
    const k1 = (mercadoPago.criarOrder as jest.Mock).mock.calls[0][0]
      .idempotencyKey;
    const k2 = (mercadoPago.criarOrder as jest.Mock).mock.calls[1][0]
      .idempotencyKey;
    expect(k1).toBe(k2);
  });

  it('order criada no MP mas persistência local ainda ausente: reexecução idempotente alinha estado', async () => {
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        orderId: 'ORD1',
        checkoutUrl: 'https://checkout/recuperado',
      }),
      consultarOrder: jest.fn(),
    };
    const intencao = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.INTENCAO,
      linkPagamento: null,
    });
    const cobrancas = {
      buscarPorId: jest.fn().mockResolvedValue(intencao),
      atualizar: jest.fn().mockImplementation(async (_c, _id, c) => c),
    };
    const orders = {
      buscarAtivaPorCobrancaId: jest
        .fn()
        .mockResolvedValueOnce({
          mercadoPagoOrderId: 'ORD1',
          checkoutUrl: 'https://checkout/recuperado',
        })
        .mockResolvedValue(null),
      criar: jest.fn(),
    };
    const servico = new CriarOrderMercadoPagoService(
      new UnitOfWorkFake(),
      cobrancas as unknown as CobrancaGateway,
      {
        obterPorCobrancaId: jest.fn().mockResolvedValue({
          chaveIdempotencia: 'k1',
          situacao: 'EM_ANDAMENTO',
        }),
        garantirEmAndamento: jest.fn(),
        marcarConcluida: jest.fn(),
      },
      orders as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );
    await servico.executar('c1');
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('chamada externa não ocorre dentro de unitOfWork.executar', async () => {
    let profundidadeTransacao = 0;
    const uow = {
      executar: jest.fn(async (trabalho) => {
        profundidadeTransacao += 1;
        try {
          return await trabalho({} as never);
        } finally {
          profundidadeTransacao -= 1;
        }
      }),
    };
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn().mockImplementation(async () => {
        expect(profundidadeTransacao).toBe(0);
        return { tipo: 'indeterminado', motivo: 'x' };
      }),
      consultarOrder: jest.fn(),
    };
    const intencao = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.INTENCAO,
    });
    const servico = new CriarOrderMercadoPagoService(
      uow as never,
      {
        buscarPorId: jest.fn().mockResolvedValue(intencao),
        atualizar: jest.fn(),
      } as unknown as CobrancaGateway,
      {
        obterPorCobrancaId: jest.fn().mockResolvedValue(null),
        garantirEmAndamento: jest.fn().mockResolvedValue({
          chaveIdempotencia: 'k',
          situacao: 'EM_ANDAMENTO',
        }),
        marcarConcluida: jest.fn(),
      },
      { buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null) } as never,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );
    await servico.executar('c1');
    expect(mercadoPago.criarOrder).toHaveBeenCalledTimes(1);
  });

  it('segunda conciliação após pagamento não duplica PagamentoConfirmado', async () => {
    const outbox: OutboxGateway = { registrar: jest.fn() };
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
              dateApproved: '2026-11-15T12:00:00.000Z',
            },
          ],
        },
      }),
    };
    let situacaoAtual: Cobranca = cobrancaPendente;
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockImplementation(async () => situacaoAtual),
      atualizar: jest.fn().mockImplementation(async (_c, _id, c) => {
        situacaoAtual = c;
        return c;
      }),
    };
    const conciliar = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      outbox,
      {
        executar: jest.fn(),
      } as unknown as import('./reemitir-order-mercado-pago.service').ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
    );
    await conciliar.conciliarPorCobrancaId('c1');
    await conciliar.conciliarPorCobrancaId('c1');
    expect(outbox.registrar).toHaveBeenCalledTimes(1);
    expect(situacaoAtual.situacao).toBe(SituacaoCobranca.PAGA);
  });

  it('webhooks duplicados não regridem cobrança já paga', async () => {
    const paga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date('2026-11-15T12:00:00.000Z'),
    });
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'action_required',
          pagamentos: [{ id: 'PAY-F', status: 'failed', statusDetail: 'x' }],
        },
      }),
    };
    const outbox: OutboxGateway = { registrar: jest.fn() };
    const conciliar = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(paga),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(paga),
        atualizar: jest.fn(),
      } as unknown as CobrancaGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      outbox,
      {
        executar: jest.fn(),
      } as unknown as import('./reemitir-order-mercado-pago.service').ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
    );
    const caso = new ProcessarNotificacaoMercadoPagoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(paga),
      } as unknown as CobrancaGateway,
      { registrar: jest.fn() } as unknown as AvisoWebhookGateway,
      conciliar,
    );
    await caso.execute({ mercadoPagoOrderId: 'ORD1', requestId: 'r1' });
    await caso.execute({ mercadoPagoOrderId: 'ORD1', requestId: 'r2' });
    expect(outbox.registrar).not.toHaveBeenCalled();
    expect(paga.situacao).toBe(SituacaoCobranca.PAGA);
  });

  it('persiste aviso de webhook antes de conciliar (ordem do caso de uso)', async () => {
    const ordem: string[] = [];
    const caso = new ProcessarNotificacaoMercadoPagoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorMercadoPagoOrderId: jest
          .fn()
          .mockResolvedValue(cobrancaPendente),
      } as unknown as CobrancaGateway,
      {
        registrar: jest.fn(async () => {
          ordem.push('aviso');
        }),
      } as unknown as AvisoWebhookGateway,
      {
        conciliarPorMercadoPagoOrderId: jest.fn(async () => {
          ordem.push('conciliar');
          return cobrancaPendente;
        }),
      } as unknown as ConciliarCobrancaService,
    );
    await caso.execute({ mercadoPagoOrderId: 'ORD1', requestId: 'req' });
    expect(ordem).toEqual(['aviso', 'conciliar']);
  });

  it('recusa mantém mesma order; reemissão usa prazo original preservado', async () => {
    const tentativas = { registrarSeNova: jest.fn().mockResolvedValue(true) };
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'action_required',
          statusDetail: 'waiting_retry',
          pagamentos: [
            {
              id: 'PAY1',
              status: 'failed',
              statusDetail: 'insufficient_amount',
            },
          ],
        },
      }),
      criarOrder: jest.fn(),
    };
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobrancaPendente),
      atualizar: jest.fn().mockImplementation(async (_c, _id, c) => c),
    };
    const conciliar = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      tentativas as unknown as TentativaRecusaGateway,
      { registrar: jest.fn() },
      {
        executar: jest.fn(),
      } as unknown as import('./reemitir-order-mercado-pago.service').ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
    );
    await conciliar.conciliarPorCobrancaId('c1');
    expect(tentativas.registrarSeNova).toHaveBeenCalled();
    expect(cobrancaPendente.linkPagamento).toBe('https://checkout/original');
    expect(cobrancaPendente.prazoPagamento).toEqual(prazoOriginal);
  });

  it('pagamento após prazo de negócio: confirma via GET sem estorno automático (E18 fora)', async () => {
    const foraDoPrazo = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10000,
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'https://checkout/original',
      prazoPagamento: new Date('2000-01-01T00:00:00.000Z'),
    });
    const outbox: OutboxGateway = { registrar: jest.fn() };
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
              dateApproved: '2026-11-15T12:00:00.000Z',
            },
          ],
        },
      }),
    };
    let estado = foraDoPrazo;
    const conciliar = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockImplementation(async () => estado),
        atualizar: jest.fn().mockImplementation(async (_c, _id, c) => {
          estado = c;
        }),
      } as unknown as CobrancaGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      outbox,
      {
        executar: jest.fn(),
      } as unknown as import('./reemitir-order-mercado-pago.service').ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
    );
    await conciliar.conciliarPorCobrancaId('c1');
    expect(outbox.registrar).toHaveBeenCalledTimes(1);
    expect((outbox.registrar as jest.Mock).mock.calls[0][1].eventType).toBe(
      'billing.pagamento-confirmado.v1',
    );
    expect(mercadoPago.consultarOrder).toHaveBeenCalled();
  });
});
