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

  it('confirma pagamento só após consulta com pagamento accredited', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
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
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      { registrarSeNova: jest.fn() } as unknown as TentativaRecusaGateway,
      outbox,
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
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
      } as unknown as OrderMercadoPagoGateway,
      {
        consultarOrder: jest.fn(),
      } as unknown as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      outbox,
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(registros).toHaveLength(0);
  });

  it('registra recusa sem emitir PagamentoConfirmado', async () => {
    const tentativas = { registrarSeNova: jest.fn().mockResolvedValue(true) };
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
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
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      tentativas as unknown as TentativaRecusaGateway,
      outbox,
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
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
      buscarPorId: jest
        .fn()
        .mockResolvedValueOnce(pendente)
        .mockResolvedValueOnce(paga),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const registros: Array<{ eventType: string }> = [];
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
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
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        desativar: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      reemitir as unknown as ReemitirOrderMercadoPagoService,
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
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('ignora cobrança inexistente', async () => {
    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(null),
      } as unknown as CobrancaGateway,
      {} as OrderMercadoPagoGateway,
      {} as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
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
      atualizar: jest.fn(),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
        desativar: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      reemitir as unknown as ReemitirOrderMercadoPagoService,
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
    );
    await expect(
      servico.conciliarPorMercadoPagoOrderId('ORD-X'),
    ).resolves.toBeNull();
  });

  it('concilia por mercado pago order id', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(cobranca),
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn(),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(order),
      } as unknown as OrderMercadoPagoGateway,
      {
        consultarOrder: jest
          .fn()
          .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
      } as unknown as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
    );

    await servico.conciliarPorMercadoPagoOrderId('ORD1');
    expect(cobrancas.buscarPorMercadoPagoOrderId).toHaveBeenCalledWith('ORD1');
  });

  it('libera bloqueio quando não há order ativa', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
      atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    } as unknown as CobrancaGateway;

    const servico = new ConciliarCobrancaService(
      new UnitOfWorkFake(),
      cobrancas,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
      } as unknown as OrderMercadoPagoGateway,
      { consultarOrder: jest.fn() } as unknown as MercadoPagoGateway,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('não confirma pagamento quando consulta é indeterminada', async () => {
    const cobrancas: CobrancaGateway = {
      buscarPorId: jest.fn().mockResolvedValue(cobranca),
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
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          registros.push({ eventType: msg.eventType });
        }),
      },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
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
      } as unknown as OrderMercadoPagoGateway,
      mercadoPago,
      {} as TentativaRecusaGateway,
      { registrar: jest.fn() },
      { executar: jest.fn() } as unknown as ReemitirOrderMercadoPagoService,
    );

    await servico.conciliarPorCobrancaId('c1');
    expect(cobrancas.atualizarSePosse).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      expect.any(Cobranca),
      posse,
    );
  });
});
