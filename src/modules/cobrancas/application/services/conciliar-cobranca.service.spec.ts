import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import type { TentativaRecusaGateway } from '../ports/tentativa-recusa.gateway';
import { ConciliarCobrancaService } from './conciliar-cobranca.service';
import type { ReemitirOrderMercadoPagoService } from './reemitir-order-mercado-pago.service';
import type { RegistrarSegundoPagamentoService } from './registrar-segundo-pagamento.service';
import type { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

const criarSegundoPagamentoStub = (): RegistrarSegundoPagamentoService =>
  ({
    orderEhSegundoPagamento: jest.fn().mockResolvedValue(false),
    registrar: jest.fn().mockResolvedValue(null),
    iniciarEstorno: jest.fn(),
  }) as unknown as RegistrarSegundoPagamentoService;

const criarPagamentoTardioStub = (): TratarPagamentoTardioService =>
  ({
    deveTratarPagamentoTardio: jest.fn().mockReturnValue(false),
    tratar: jest.fn(),
  }) as unknown as TratarPagamentoTardioService;

describe('ConciliarCobrancaService', () => {
  const cobranca = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 1000,
    prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
    situacao: SituacaoCobranca.PENDENTE,
    linkPagamento: 'https://checkout',
  });

  const order = {
    id: 'omp1',
    cobrancaId: 'c1',
    mercadoPagoOrderId: 'ORD1',
    chaveIdempotencia: 'k1',
    checkoutUrl: 'https://checkout',
    ativa: true,
  };

  it('pagamento após prazo dispara tratamento tardio em vez de confirmar', async () => {
    const tardio = {
      deveTratarPagamentoTardio: jest.fn().mockReturnValue(true),
      tratar: jest.fn(),
    };
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
      } as unknown as CobrancaGateway,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
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
                dateApproved: '2099-06-02T00:00:00.000Z',
              },
            ],
          },
        }),
      } as unknown as MercadoPagoGateway,
      { registrarSeNova: jest.fn() } as unknown as TentativaRecusaGateway,
      { registrar: jest.fn() } as OutboxGateway,
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      tardio as unknown as TratarPagamentoTardioService,
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(tardio.tratar).toHaveBeenCalled();
  });

  it('confirma pagamento só após consulta com pagamento accredited', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'processed',
          statusDetail: 'accredited',
          pagamentos: [
            {
              id: 'PAY1',
              status: 'accredited',
              dateApproved: '2026-11-15T12:00:00.000Z',
            },
          ],
        },
      }),
    } as unknown as MercadoPagoGateway;

    const registros: Array<{ eventType: string }> = [];
    const outbox: OutboxGateway = {
      registrar: jest.fn(async (_ctx, msg) => {
        registros.push({ eventType: msg.eventType });
      }),
    };
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrarSeNova: jest.fn() } as unknown as TentativaRecusaGateway,
      outbox,
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');

    expect(cobrancas.atualizar).toHaveBeenCalled();
    expect(registros).toHaveLength(1);
    expect(registros[0]?.eventType).toBe('billing.pagamento-confirmado.v1');
  });

  it('não repete PagamentoConfirmado quando cobrança já está paga', async () => {
    const paga = new Cobranca({
      id: cobranca.id,
      orcamentoId: cobranca.orcamentoId,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      clienteId: cobranca.clienteId,
      correlationId: cobranca.correlationId,
      valorTotalCentavos: cobranca.valorTotalCentavos,
      prazoPagamento: cobranca.prazoPagamento,
      situacao: SituacaoCobranca.PAGA,
      linkPagamento: cobranca.linkPagamento,
      pagamentoConfirmadoEm: new Date('2026-11-15T12:00:00.000Z'),
    });

    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(paga),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(paga),
      atualizar: jest.fn(),
    } as unknown as CobrancaGateway;

    const registros: Array<{ eventType: string }> = [];
    const outbox: OutboxGateway = {
      registrar: jest.fn(async (_ctx, msg) => {
        registros.push({ eventType: msg.eventType });
      }),
    };
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      {
        consultarOrder: jest.fn(),
      } as unknown as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      outbox,
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(registros).toHaveLength(0);
  });

  it('registra recusa sem emitir PagamentoConfirmado', async () => {
    const tentativas = { registrarSeNova: jest.fn().mockResolvedValue(true) };
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'action_required',
          statusDetail: 'waiting_retry',
          pagamentos: [
            {
              id: 'PAY-FUND',
              status: 'failed',
              statusDetail: 'insufficient_amount',
            },
          ],
        },
      }),
    } as unknown as MercadoPagoGateway;

    const registros: Array<{ eventType: string }> = [];
    const outbox: OutboxGateway = {
      registrar: jest.fn(async (_ctx, msg) => {
        registros.push({ eventType: msg.eventType });
      }),
    };

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      tentativas as unknown as TentativaRecusaGateway,
      outbox,
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(tentativas.registrarSeNova).toHaveBeenCalled();
    expect(registros).toHaveLength(0);
  });

  it('não duplica confirmação se cobrança virou paga durante conciliação', async () => {
    const pendente = cobranca;
    const paga = new Cobranca({
      id: cobranca.id,
      orcamentoId: cobranca.orcamentoId,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      clienteId: cobranca.clienteId,
      correlationId: cobranca.correlationId,
      valorTotalCentavos: cobranca.valorTotalCentavos,
      prazoPagamento: cobranca.prazoPagamento,
      situacao: SituacaoCobranca.PAGA,
      linkPagamento: cobranca.linkPagamento,
      pagamentoConfirmadoEm: new Date(),
    });

    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValueOnce(pendente),
      bloquearParaAtualizacao: jest.fn().mockResolvedValueOnce(paga),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const registros: Array<{ eventType: string }> = [];
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
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
                dateApproved: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        }),
      } as unknown as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          registros.push({ eventType: msg.eventType });
        }),
      },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(registros).toHaveLength(0);
  });

  it('agenda reemissão após commit quando encerrada sem pagamento e ainda no prazo', async () => {
    const reemitir = { executar: jest.fn() };
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'canceled',
          statusDetail: 'expired',
          pagamentos: [],
        },
      }),
    } as unknown as MercadoPagoGateway;

    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
        desativar: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      reemitir as unknown as ReemitirOrderMercadoPagoService,
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(reemitir.executar).toHaveBeenCalledWith('c1', null);
  });

  it('mantém pendente em aguardando_pagamento', async () => {
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'created',
          pagamentos: [],
        },
      }),
    } as unknown as MercadoPagoGateway;

    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('ignora cobrança inexistente', async () => {
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(null),
        bloquearParaAtualizacao: jest.fn().mockResolvedValue(null),
      } as unknown as CobrancaGateway,
      {} as OrderMercadoPagoGateway,
      {} as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );
    await servico.conciliarPorCobrancaId('c1');
  });

  it('ainda agenda reemissão quando serviço dedicado tratar falha na MP', async () => {
    const reemitir = { executar: jest.fn() };
    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'canceled',
          statusDetail: 'expired',
          pagamentos: [],
        },
      }),
    } as unknown as MercadoPagoGateway;

    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn(),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
        desativar: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      reemitir as unknown as ReemitirOrderMercadoPagoService,
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(reemitir.executar).toHaveBeenCalled();
  });

  it('retorna nulo ao conciliar order desconhecida', async () => {
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(null),
      } as unknown as CobrancaGateway,
      {} as OrderMercadoPagoGateway,
      {} as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );
    await expect(
      servico.conciliarPorMercadoPagoOrderId('ORD-X'),
    ).resolves.toBeNull();
  });

  it('concilia por mercado pago order id', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(cobranca),
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn(),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      {
        consultarOrder: jest
          .fn()
          .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
      } as unknown as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorMercadoPagoOrderId('ORD1');
    expect(cobrancas.buscarPorMercadoPagoOrderId).toHaveBeenCalledWith('ORD1');
  });

  it('libera bloqueio quando não há order ativa', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(null),
        marcarConfirmouPagamento: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      { consultarOrder: jest.fn() } as unknown as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('não confirma pagamento quando consulta é indeterminada', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'indeterminado',
        motivo: 'HTTP 503',
      }),
    } as unknown as MercadoPagoGateway;

    const registros: Array<{ eventType: string }> = [];
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          registros.push({ eventType: msg.eventType });
        }),
      },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(registros).toHaveLength(0);
  });

  it('consulta indeterminada libera bloqueio com fence da reivindicação', async () => {
    const posse = new Date(Date.now() + 60_000);
    const comPosse = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'https://checkout',
      bloqueadoConciliacaoAte: posse,
    });
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(comPosse),
      bloquearParaAtualizacao: jest.fn().mockResolvedValue(comPosse),
      atualizar: jest.fn(),
      atualizarSePosse: jest.fn().mockResolvedValue(true),
    } as unknown as CobrancaGateway;

    const mercadoPago: MercadoPagoGateway = {
      consultarOrder: jest.fn().mockResolvedValue({ tipo: 'indeterminado' }),
    };

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(order),
        marcarConfirmouPagamento: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
      criarPagamentoTardioStub(),
      criarSegundoPagamentoStub(),
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(cobrancas.atualizarSePosse).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      expect.any(Cobranca),
      posse,
    );
  });

  describe('segundo pagamento', () => {
    const aprovadoEm = '2026-11-15T12:00:00.000Z';

    const orderSegunda = {
      id: 'omp2',
      cobrancaId: 'c1',
      mercadoPagoOrderId: 'ORD2',
      chaveIdempotencia: 'k2',
      checkoutUrl: 'https://checkout2',
      ativa: false,
    };

    const consultaPaga = {
      tipo: 'sucesso',
      order: {
        id: 'ORD2',
        status: 'processed',
        pagamentos: [
          { id: 'PAY2', status: 'accredited', dateApproved: aprovadoEm },
        ],
      },
    };

    function cobrancaEm(situacao: SituacaoCobranca): Cobranca {
      return new Cobranca({
        id: 'c1',
        orcamentoId: 'o1',
        ordemServicoId: 'os1',
        rodada: 1,
        clienteId: 'cl1',
        correlationId: 'corr',
        valorTotalCentavos: 1000,
        prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
        situacao,
        pagamentoConfirmadoEm: new Date('2026-11-15T11:00:00.000Z'),
      });
    }

    function montar(opcoes: {
      cobranca: Cobranca;
      cobrancaNaTransacao?: Cobranca;
      consulta?: unknown;
      segundoPagamento?: Partial<Record<string, jest.Mock>>;
      orderAtiva?: unknown;
    }) {
      const cobrancas = {
        buscarPorId: jest.fn().mockResolvedValue(opcoes.cobranca),
        bloquearParaAtualizacao: jest
          .fn()
          .mockResolvedValue(opcoes.cobrancaNaTransacao ?? opcoes.cobranca),
        buscarPorMercadoPagoOrderId: jest
          .fn()
          .mockResolvedValue(opcoes.cobranca),
        atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
      };
      const orders = {
        buscarAtivaPorCobrancaId: jest
          .fn()
          .mockResolvedValue(opcoes.orderAtiva ?? null),
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(orderSegunda),
        marcarConfirmouPagamento: jest.fn(),
        atualizarSituacao: jest.fn(),
      };
      const mercadoPago = {
        consultarOrder: jest
          .fn()
          .mockResolvedValue(opcoes.consulta ?? consultaPaga),
      };
      const registros: Array<{ eventType: string }> = [];
      const outbox = {
        registrar: jest.fn(async (_ctx, msg) => {
          registros.push({ eventType: msg.eventType });
        }),
      };
      const segundoPagamento = {
        orderEhSegundoPagamento: jest.fn().mockResolvedValue(true),
        registrar: jest.fn().mockResolvedValue('e1'),
        iniciarEstorno: jest.fn(),
        ...opcoes.segundoPagamento,
      };
      const tardio = {
        deveTratarPagamentoTardio: jest.fn().mockReturnValue(false),
        tratar: jest.fn(),
      };
      const servico = new ConciliarCobrancaService(
        new UnitOfWorkFake(),
        cobrancas as unknown as CobrancaGateway,
        orders as unknown as OrderMercadoPagoGateway,
        mercadoPago as unknown as MercadoPagoGateway,
        { registrarSeNova: jest.fn() } as unknown as TentativaRecusaGateway,
        outbox as OutboxGateway,
        { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
        tardio as unknown as TratarPagamentoTardioService,
        segundoPagamento as unknown as RegistrarSegundoPagamentoService,
      );
      return {
        servico,
        cobrancas,
        orders,
        mercadoPago,
        outbox,
        registros,
        segundoPagamento,
        tardio,
      };
    }

    it('webhook da order que confirmou o pagamento não consulta nem registra nada', async () => {
      const { servico, mercadoPago, segundoPagamento } = montar({
        cobranca: cobrancaEm(SituacaoCobranca.PAGA),
        segundoPagamento: {
          orderEhSegundoPagamento: jest.fn().mockResolvedValue(false),
        },
      });

      await servico.conciliarPorMercadoPagoOrderId('ORD2');

      expect(mercadoPago.consultarOrder).not.toHaveBeenCalled();
      expect(segundoPagamento.registrar).not.toHaveBeenCalled();
    });

    it.each([
      SituacaoCobranca.PAGA,
      SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
      SituacaoCobranca.ESTORNADA,
      SituacaoCobranca.PENDENCIA_MANUAL,
    ])(
      'webhook de outra order paga com a cobrança %s registra o segundo pagamento e inicia o estorno',
      async (situacao) => {
        const { servico, mercadoPago, segundoPagamento, registros } = montar({
          cobranca: cobrancaEm(situacao),
        });

        await servico.conciliarPorMercadoPagoOrderId('ORD2');

        expect(mercadoPago.consultarOrder).toHaveBeenCalledWith('ORD2');
        expect(segundoPagamento.registrar).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            order: orderSegunda,
            aprovadoEm: new Date(aprovadoEm),
          }),
        );
        expect(segundoPagamento.iniciarEstorno).toHaveBeenCalledWith('e1');
        expect(registros).toHaveLength(0);
      },
    );

    it('não confirma de novo a cobrança nem marca a segunda order como legítima', async () => {
      const { servico, cobrancas, orders } = montar({
        cobranca: cobrancaEm(SituacaoCobranca.PAGA),
      });

      await servico.conciliarPorMercadoPagoOrderId('ORD2');

      expect(orders.marcarConfirmouPagamento).not.toHaveBeenCalled();
      const [, , gravada] = cobrancas.atualizar.mock.calls[0];
      expect(gravada.situacao).toBe(SituacaoCobranca.PAGA);
    });

    it('registra o segundo pagamento quando a cobrança foi confirmada por outra order durante a conciliação', async () => {
      const { servico, segundoPagamento, registros } = montar({
        cobranca: cobranca,
        cobrancaNaTransacao: cobrancaEm(SituacaoCobranca.PAGA),
        orderAtiva: orderSegunda,
      });

      await servico.conciliarPorCobrancaId('c1');

      expect(segundoPagamento.registrar).toHaveBeenCalledTimes(1);
      expect(segundoPagamento.iniciarEstorno).toHaveBeenCalledWith('e1');
      expect(registros).toHaveLength(0);
    });

    it('não inicia estorno quando o registro já existia e nada há a retomar', async () => {
      const { servico, segundoPagamento } = montar({
        cobranca: cobrancaEm(SituacaoCobranca.PAGA),
        segundoPagamento: { registrar: jest.fn().mockResolvedValue(null) },
      });

      await servico.conciliarPorMercadoPagoOrderId('ORD2');

      expect(segundoPagamento.iniciarEstorno).not.toHaveBeenCalled();
    });

    it('não registra segundo pagamento quando a consulta não mostra pagamento aprovado', async () => {
      const { servico, segundoPagamento } = montar({
        cobranca: cobrancaEm(SituacaoCobranca.PAGA),
        consulta: {
          tipo: 'sucesso',
          order: { id: 'ORD2', status: 'created', pagamentos: [] },
        },
      });

      await servico.conciliarPorMercadoPagoOrderId('ORD2');

      expect(segundoPagamento.registrar).not.toHaveBeenCalled();
    });

    it('não registra nada quando a consulta da segunda order é indeterminada', async () => {
      const { servico, segundoPagamento, cobrancas } = montar({
        cobranca: cobrancaEm(SituacaoCobranca.PAGA),
        consulta: { tipo: 'indeterminado', motivo: 'timeout' },
      });

      await servico.conciliarPorMercadoPagoOrderId('ORD2');

      expect(segundoPagamento.registrar).not.toHaveBeenCalled();
      expect(cobrancas.bloquearParaAtualizacao).not.toHaveBeenCalled();
    });

    it('confirma o pagamento com a order avisada, não com a ativa, e a marca como legítima', async () => {
      const { servico, mercadoPago, orders, registros } = montar({
        cobranca: cobranca,
        orderAtiva: order,
      });
      orders.buscarPorMercadoPagoOrderId.mockResolvedValue(orderSegunda);

      await servico.conciliarPorMercadoPagoOrderId('ORD2');

      expect(mercadoPago.consultarOrder).toHaveBeenCalledWith('ORD2');
      expect(orders.buscarAtivaPorCobrancaId).not.toHaveBeenCalled();
      expect(orders.marcarConfirmouPagamento).toHaveBeenCalledWith(
        expect.anything(),
        'omp2',
      );
      expect(registros).toEqual([
        { eventType: 'billing.pagamento-confirmado.v1' },
      ]);
    });

    it('marca como legítima a order que confirma o primeiro pagamento na conciliação periódica', async () => {
      const { servico, orders } = montar({
        cobranca: cobranca,
        orderAtiva: order,
      });

      await servico.conciliarPorCobrancaId('c1');

      expect(orders.marcarConfirmouPagamento).toHaveBeenCalledWith(
        expect.anything(),
        'omp1',
      );
    });

    it('pagamento de order anterior numa cobrança expirada segue o tratamento tardio', async () => {
      const { servico, tardio } = montar({
        cobranca: new Cobranca({
          ...cobranca,
          situacao: SituacaoCobranca.EXPIRADA,
        }),
      });
      tardio.deveTratarPagamentoTardio.mockReturnValue(true);

      await servico.conciliarPorMercadoPagoOrderId('ORD2');

      expect(tardio.tratar).toHaveBeenCalledWith({
        cobrancaId: 'c1',
        posseAte: null,
        orderId: 'omp2',
        aprovadoEm: new Date(aprovadoEm),
      });
    });

    it('conciliação periódica de cobrança paga continua sem consultar order', async () => {
      const { servico, mercadoPago, orders } = montar({
        cobranca: cobrancaEm(SituacaoCobranca.PAGA),
      });

      await servico.conciliarPorCobrancaId('c1');

      expect(orders.buscarAtivaPorCobrancaId).not.toHaveBeenCalled();
      expect(mercadoPago.consultarOrder).not.toHaveBeenCalled();
    });

    it('concilia por order desconhecida sem efeito', async () => {
      const { servico, cobrancas } = montar({ cobranca: cobranca });
      cobrancas.buscarPorMercadoPagoOrderId.mockResolvedValue(null);

      await expect(
        servico.conciliarPorMercadoPagoOrderId('DESCONHECIDA'),
      ).resolves.toBeNull();
    });
  });
});
