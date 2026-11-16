import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '../ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from '../ports/order-mercado-pago.gateway';
import { CriarOrderMercadoPagoService } from './criar-order-mercado-pago.service';

function montarServico(
  overrides: Partial<{
    cobrancas: CobrancaGateway;
    operacoes: OperacaoCriacaoOrderGateway;
    orders: OrderMercadoPagoGateway;
    mercadoPago: MercadoPagoGateway;
    outbox: OutboxGateway;
  }> = {},
) {
  const cobranca = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 15000,
    prazoPagamento: new Date('2099-12-31T00:00:00.000Z'),
    situacao: SituacaoCobranca.INTENCAO,
  });

  const cobrancas: CobrancaGateway = {
    buscarPorId: jest.fn().mockResolvedValue(cobranca),
    atualizar: jest.fn().mockImplementation(async (_ctx, _id, c) => c),
    atualizarSePosse: jest.fn().mockResolvedValue(true),
    ...(overrides.cobrancas ?? {}),
  } as unknown as CobrancaGateway;

  let chavePersistida: string | undefined;
  const operacoes: OperacaoCriacaoOrderGateway = {
    obterPorCobrancaId: jest.fn().mockImplementation(async () => {
      if (!chavePersistida) return null;
      return {
        cobrancaId: 'c1',
        chaveIdempotencia: chavePersistida,
        situacao: 'EM_ANDAMENTO',
      };
    }),
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
    ...(overrides.operacoes ?? {}),
  };

  const outboxRegistros: string[] = [];
  const outbox: OutboxGateway = {
    registrar: jest.fn(async (_ctx, msg) => {
      outboxRegistros.push(msg.eventType);
    }),
    ...(overrides.outbox ?? {}),
  };

  const servico = new CriarOrderMercadoPagoService(
    new UnitOfWorkFake(),
    cobrancas,
    operacoes,
    {
      buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
      criar: jest.fn().mockResolvedValue({ id: 'omp1' }),
      ...(overrides.orders ?? {}),
    } as unknown as OrderMercadoPagoGateway,
    {
      criarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        orderId: 'ORD1',
        checkoutUrl: 'https://checkout/1',
      }),
      consultarOrder: jest.fn(),
      ...(overrides.mercadoPago ?? {}),
    } as unknown as MercadoPagoGateway,
    outbox,
    { existe: jest.fn().mockResolvedValue(false) },
    'comprador@example.com',
  );

  return { servico, cobrancas, outboxRegistros, cobranca };
}

describe('CriarOrderMercadoPagoService', () => {
  it('ignora cobrança fora de INTENCAO', async () => {
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 15000,
      prazoPagamento: new Date('2099-12-31T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn(),
      consultarOrder: jest.fn(),
    };
    const servico = new CriarOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
      } as unknown as CobrancaGateway,
      {} as OperacaoCriacaoOrderGateway,
      {} as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );
    await servico.executar('c1');
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
  });

  it('ignora cobrança inexistente', async () => {
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn(),
      consultarOrder: jest.fn(),
    };
    const servico = new CriarOrderMercadoPagoService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(null),
      } as unknown as CobrancaGateway,
      {} as OperacaoCriacaoOrderGateway,
      {} as OrderMercadoPagoGateway,
      mercadoPago,
      { registrar: jest.fn() },
      { existe: jest.fn().mockResolvedValue(false) },
      'comprador@example.com',
    );
    await servico.executar('c1');
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
  });

  it('reutiliza a mesma chave de idempotência ao repetir após indeterminado', async () => {
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

    const { servico } = montarServico({ mercadoPago });
    await servico.executar('c1');
    await servico.executar('c1');

    const primeiraChamada = (mercadoPago.criarOrder as jest.Mock).mock
      .calls[0]?.[0];
    const segundaChamada = (mercadoPago.criarOrder as jest.Mock).mock
      .calls[1]?.[0];
    expect(primeiraChamada.idempotencyKey).toBe(segundaChamada.idempotencyKey);
  });

  it('publica CobrancaCriada após sucesso na Orders API', async () => {
    const { servico, outboxRegistros } = montarServico();
    await servico.executar('c1');
    expect(outboxRegistros).toContain('billing.cobranca-criada.v1');
  });

  it('não chama Mercado Pago quando operação já concluída', async () => {
    const mercadoPago: MercadoPagoGateway = {
      criarOrder: jest.fn(),
      consultarOrder: jest.fn(),
    };
    const { servico } = montarServico({
      mercadoPago,
      operacoes: {
        obterPorCobrancaId: jest.fn().mockResolvedValue({
          cobrancaId: 'c1',
          chaveIdempotencia: 'chave',
          situacao: 'CONCLUIDA',
        }),
        garantirEmAndamento: jest.fn(),
        marcarConcluida: jest.fn(),
      },
    });
    await servico.executar('c1');
    expect(mercadoPago.criarOrder).not.toHaveBeenCalled();
  });

  it('sincroniza pendente quando já existe order ativa', async () => {
    const { servico, cobrancas } = montarServico({
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          checkoutUrl: 'https://existente',
        }),
      } as unknown as OrderMercadoPagoGateway,
    });
    await servico.executar('c1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('não publica outbox quando perdeu a reivindicação (fence)', async () => {
    const posse = new Date(Date.now() + 60_000);
    const comPosse = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 15000,
      prazoPagamento: new Date('2099-12-31T00:00:00.000Z'),
      situacao: SituacaoCobranca.INTENCAO,
      bloqueadoConciliacaoAte: posse,
    });
    const outbox: OutboxGateway = { registrar: jest.fn() };
    const { servico } = montarServico({
      cobrancas: {
        buscarPorId: jest.fn().mockResolvedValue(comPosse),
        atualizar: jest.fn(),
        atualizarSePosse: jest.fn().mockResolvedValue(false),
      } as unknown as CobrancaGateway,
      outbox,
    });
    await servico.executar('c1');
    expect(outbox.registrar).not.toHaveBeenCalled();
  });
});
