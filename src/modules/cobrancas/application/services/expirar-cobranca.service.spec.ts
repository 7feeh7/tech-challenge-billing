import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { EVENTO_COBRANCA_EXPIRADA } from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import { ExpirarCobrancaService } from './expirar-cobranca.service';
import type { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

describe('ExpirarCobrancaService', () => {
  const cobranca = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 1000,
    prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
    situacao: SituacaoCobranca.PENDENTE,
    linkPagamento: 'https://checkout',
  });

  it('não faz nada quando cobrança não existe', async () => {
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      { buscarPorId: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      {} as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('inexistente');
  });

  it('não expira cobrança ainda no prazo', async () => {
    const futura = new Cobranca({
      ...cobranca,
      prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
    });
    const atualizar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(futura),
        atualizar,
        atualizarSePosse: jest.fn(),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(atualizar).toHaveBeenCalled();
  });

  it('expira sem order ativa publicando evento', async () => {
    const outbox = { registrar: jest.fn() };
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn().mockResolvedValue(true),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
      } as never,
      {} as never,
      outbox as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(outbox.registrar).toHaveBeenCalled();
  });

  it('finaliza expiração quando consulta já mostra encerrada', async () => {
    const cancelarOrder = jest.fn();
    const outbox = { registrar: jest.fn() };
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn().mockResolvedValue(true),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: {
            id: 'ORD1',
            status: 'canceled',
            statusDetail: 'expired',
            pagamentos: [],
          },
        }),
        cancelarOrder,
      } as never,
      outbox as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(outbox.registrar).toHaveBeenCalled();
    expect(cancelarOrder).not.toHaveBeenCalled();
  });

  it('delega pagamento tardio quando order já está paga', async () => {
    const tratar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: {
            id: 'ORD1',
            status: 'processed',
            pagamentos: [
              {
                id: 'PAY',
                status: 'accredited',
                dateApproved: '2020-02-01T00:00:00.000Z',
              },
            ],
          },
        }),
      } as never,
      {} as never,
      { tratar } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(tratar).toHaveBeenCalled();
  });

  it('libera bloqueio quando consulta MP fica indeterminada', async () => {
    const atualizar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar,
        atualizarSePosse: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'indeterminado',
          motivo: 'timeout',
        }),
      } as never,
      {} as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(atualizar).toHaveBeenCalled();
  });

  it('libera bloqueio quando cancelamento fica indeterminado', async () => {
    const atualizar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar,
        atualizarSePosse: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
        }),
        cancelarOrder: jest.fn().mockResolvedValue({
          tipo: 'indeterminado',
          motivo: 'timeout',
        }),
      } as never,
      {} as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(atualizar).toHaveBeenCalled();
  });

  it('libera bloqueio quando confirmação pós-cancelamento fica indeterminada', async () => {
    const atualizar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar,
        atualizarSePosse: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        consultarOrder: jest
          .fn()
          .mockResolvedValueOnce({
            tipo: 'sucesso',
            order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
          })
          .mockResolvedValueOnce({
            tipo: 'indeterminado',
            motivo: 'timeout',
          }),
        cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      } as never,
      {} as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(atualizar).toHaveBeenCalled();
  });

  it('libera bloqueio quando order permanece aberta após cancelamento', async () => {
    const atualizar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar,
        atualizarSePosse: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        consultarOrder: jest
          .fn()
          .mockResolvedValueOnce({
            tipo: 'sucesso',
            order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
          })
          .mockResolvedValueOnce({
            tipo: 'sucesso',
            order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
          }),
        cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      } as never,
      {} as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(atualizar).toHaveBeenCalled();
  });

  it('ignora cobrança já expirada', async () => {
    const expirada = new Cobranca({
      ...cobranca,
      situacao: SituacaoCobranca.EXPIRADA,
    });
    const atualizar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(expirada),
        atualizar,
        atualizarSePosse: jest.fn(),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );
    await servico.expirarPorCobrancaId('c1');
    expect(atualizar).toHaveBeenCalled();
  });

  it('publica CobrancaExpirada após cancelamento confirmado', async () => {
    const outbox = { registrar: jest.fn() };
    const atualizar = jest.fn();
    const servico = new ExpirarCobrancaService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar,
        atualizarSePosse: jest.fn().mockResolvedValue(true),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
        desativar: jest.fn(),
        atualizarSituacao: jest.fn(),
      } as never,
      {
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
      } as never,
      outbox as never,
      { tratar: jest.fn() } as unknown as TratarPagamentoTardioService,
    );

    await servico.expirarPorCobrancaId('c1');
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_COBRANCA_EXPIRADA }),
    );
  });
});
