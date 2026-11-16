import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { EVENTO_PAGAMENTO_TARDIO_REGISTRADO } from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

describe('TratarPagamentoTardioService', () => {
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
  });

  it('ignora quando cobrança não existe', async () => {
    const outbox = { registrar: jest.fn() };
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      { buscarPorId: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      outbox as never,
    );
    await servico.tratar({
      cobrancaId: 'x',
      posseAte: null,
      orderId: 'loc',
      mercadoPagoOrderId: 'ORD1',
      aprovadoEm: new Date(),
      orderConsultada: { id: 'ORD1', status: 'processed', pagamentos: [] },
    });
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('identifica pagamento após prazo', () => {
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(
      servico.deveTratarPagamentoTardio(
        cobranca,
        new Date('2020-02-01T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('não publica quando estorno fica indeterminado', async () => {
    const outbox = { registrar: jest.fn() };
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        estornarTotal: jest
          .fn()
          .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
        consultarOrder: jest.fn(),
      } as never,
      outbox as never,
    );
    await servico.tratar({
      cobrancaId: 'c1',
      posseAte: null,
      orderId: 'loc',
      mercadoPagoOrderId: 'ORD1',
      aprovadoEm: new Date(),
      orderConsultada: { id: 'ORD1', status: 'processed', pagamentos: [] },
    });
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('publica direto quando order já está estornada', async () => {
    const outbox = { registrar: jest.fn() };
    const estornar = jest.fn();
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {} as never,
      { estornarTotal: estornar, consultarOrder: jest.fn() } as never,
      outbox as never,
    );
    await servico.tratar({
      cobrancaId: 'c1',
      posseAte: null,
      orderId: 'loc',
      mercadoPagoOrderId: 'ORD1',
      aprovadoEm: new Date('2020-02-01T00:00:00.000Z'),
      orderConsultada: {
        id: 'ORD1',
        status: 'refunded',
        pagamentos: [{ id: 'P1', status: 'refunded', amount: 1000 }],
      },
    });
    expect(estornar).not.toHaveBeenCalled();
    expect(outbox.registrar).toHaveBeenCalled();
  });

  it('libera bloqueio quando confirmação pós-estorno fica indeterminada', async () => {
    const atualizar = jest.fn();
    const outbox = { registrar: jest.fn() };
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar,
        atualizarSePosse: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        estornarTotal: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'indeterminado',
          motivo: 'timeout',
        }),
      } as never,
      outbox as never,
    );
    await servico.tratar({
      cobrancaId: 'c1',
      posseAte: null,
      orderId: 'loc',
      mercadoPagoOrderId: 'ORD1',
      aprovadoEm: new Date('2020-02-01T00:00:00.000Z'),
      orderConsultada: { id: 'ORD1', status: 'processed', pagamentos: [] },
    });
    expect(outbox.registrar).not.toHaveBeenCalled();
    expect(atualizar).toHaveBeenCalled();
  });

  it('deve tratar pagamento tardio em cobrança já expirada', () => {
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const expirada = new Cobranca({
      ...cobranca,
      situacao: SituacaoCobranca.EXPIRADA,
    });
    expect(
      servico.deveTratarPagamentoTardio(
        expirada,
        new Date('2020-01-01T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('estorna e publica pagamento tardio', async () => {
    const outbox = { registrar: jest.fn() };
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          chaveIdempotencia: 'chave',
        }),
        desativar: jest.fn(),
      } as never,
      {
        estornarTotal: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: { id: 'ORD1', status: 'refunded', pagamentos: [] },
        }),
      } as never,
      outbox as never,
    );

    await servico.tratar({
      cobrancaId: 'c1',
      posseAte: null,
      orderId: 'loc',
      mercadoPagoOrderId: 'ORD1',
      aprovadoEm: new Date('2020-02-01T00:00:00.000Z'),
      orderConsultada: { id: 'ORD1', status: 'processed', pagamentos: [] },
    });

    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: EVENTO_PAGAMENTO_TARDIO_REGISTRADO,
      }),
    );
  });
});
