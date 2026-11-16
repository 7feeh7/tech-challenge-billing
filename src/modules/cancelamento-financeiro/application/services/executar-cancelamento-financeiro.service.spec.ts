import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import type { MercadoPagoGateway } from '@/modules/cobrancas/application/ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '@/modules/cobrancas/application/ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from '@/modules/cobrancas/application/ports/order-mercado-pago.gateway';
import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import { SituacaoCobranca } from '@/modules/cobrancas/domain/situacao-cobranca';
import type { OrcamentoGateway } from '@/modules/orcamentos/application/ports/orcamento.gateway';
import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { EVENTO_RESPOSTA_CANCELAMENTO } from '@/shared/messaging/envelope';
import type { OperacaoFinanceiraGateway } from '../ports/operacao-financeira.gateway';
import type { PendenciaEstornoGateway } from '../ports/pendencia-estorno.gateway';
import { ExecutarCancelamentoFinanceiroService } from './executar-cancelamento-financeiro.service';

const cobrancaPendente = new Cobranca({
  id: 'c1',
  orcamentoId: 'o1',
  ordemServicoId: 'os1',
  rodada: 1,
  clienteId: 'cl1',
  correlationId: 'corr',
  valorTotalCentavos: 5000,
  prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
  situacao: SituacaoCobranca.PENDENTE,
  linkPagamento: 'https://checkout',
});

const operacaoBase = {
  id: 'op1',
  eventId: 'ev1',
  ordemServicoId: 'os1',
  rodada: 1,
  correlationId: 'corr',
  tipo: 'CANCELAMENTO_FINANCEIRO' as const,
  situacao: 'EM_ANDAMENTO' as const,
  chaveIdempotenciaMercadoPago: 'chave-mp',
  resultadoExecucao: 'REPARO_NAO_INICIADO' as const,
  tentativasMercadoPago: 0,
  motivoCancelamento: 'teste',
};

function criarServico(deps: {
  operacoes?: Partial<OperacaoFinanceiraGateway>;
  cobrancas?: Partial<CobrancaGateway>;
  mp?: Partial<MercadoPagoGateway>;
  orders?: Partial<OrderMercadoPagoGateway>;
  orcamentos?: Partial<OrcamentoGateway>;
  operacoesCriacao?: Partial<OperacaoCriacaoOrderGateway>;
  pendencias?: Partial<PendenciaEstornoGateway>;
  outbox?: OutboxGateway;
}) {
  const outboxRegistros: string[] = [];
  const outbox: OutboxGateway =
    deps.outbox ??
    ({
      registrar: jest.fn(async (_ctx, msg) => {
        outboxRegistros.push(msg.eventType);
      }),
    } as unknown as OutboxGateway);

  const operacoes: OperacaoFinanceiraGateway = {
    buscarPorId: jest.fn().mockResolvedValue(operacaoBase),
    adiarProcessamento: jest.fn(),
    incrementarTentativasMercadoPago: jest.fn(),
    concluir: jest.fn(),
    ...deps.operacoes,
  } as unknown as OperacaoFinanceiraGateway;

  const cobrancas: CobrancaGateway = {
    buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPendente),
    buscarPorId: jest.fn().mockResolvedValue(cobrancaPendente),
    atualizar: jest.fn(),
    ...deps.cobrancas,
  } as unknown as CobrancaGateway;

  const pendencias: PendenciaEstornoGateway = {
    criar: jest.fn(),
    ...deps.pendencias,
  } as PendenciaEstornoGateway;

  const servico = new ExecutarCancelamentoFinanceiroService(
    new UnitOfWorkFake(),
    operacoes,
    (deps.orcamentos ?? {
      buscarPorOrdemServicoERodadaLeitura: jest.fn().mockResolvedValue(null),
    }) as OrcamentoGateway,
    cobrancas,
    (deps.operacoesCriacao ?? {
      obterPorCobrancaId: jest.fn(),
    }) as OperacaoCriacaoOrderGateway,
    (deps.orders ?? {
      buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
      desativar: jest.fn(),
    }) as OrderMercadoPagoGateway,
    (deps.mp ?? {
      cancelarOrder: jest.fn(),
      estornarTotal: jest.fn(),
      consultarOrder: jest.fn(),
    }) as MercadoPagoGateway,
    pendencias,
    outbox,
    100,
    5,
    50,
  );

  return { servico, operacoes, cobrancas, outboxRegistros, outbox, pendencias };
}

describe('ExecutarCancelamentoFinanceiroService', () => {
  it('ignora operação inexistente ou já concluída', async () => {
    const { servico } = criarServico({
      operacoes: { buscarPorId: jest.fn().mockResolvedValue(null) },
    });
    await servico.executar('op1');
    const { servico: s2, operacoes } = criarServico({
      operacoes: {
        buscarPorId: jest.fn().mockResolvedValue({
          ...operacaoBase,
          situacao: 'CONCLUIDA',
        }),
      },
    });
    await s2.executar('op1');
    expect(operacoes.concluir).not.toHaveBeenCalled();
  });

  it('conclui com NADA_A_CANCELAR sem cobrança', async () => {
    const { servico, operacoes, outboxRegistros } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(null),
      },
    });
    await servico.executar('op1');
    expect(operacoes.concluir).toHaveBeenCalledWith(
      expect.anything(),
      'op1',
      expect.objectContaining({ resultado: 'NADA_A_CANCELAR' }),
    );
    expect(outboxRegistros).toContain(EVENTO_RESPOSTA_CANCELAMENTO);
  });

  it('cancela cobrança pendente sem order ativa', async () => {
    const { servico, cobrancas } = criarServico({});
    await servico.executar('op1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('chama MP cancelar quando há order ativa', async () => {
    const mp = {
      cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'canceled',
          pagamentos: [],
        },
      }),
    };
    const { servico } = criarServico({
      mp,
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
      },
    });
    await servico.executar('op1');
    expect(mp.cancelarOrder).toHaveBeenCalledWith('ORD1', 'chave-mp');
  });

  it('REPARO_INICIADO em cobrança paga abre pendência e não estorna', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const mp = { estornarTotal: jest.fn() };
    const { servico, pendencias } = criarServico({
      operacoes: {
        buscarPorId: jest.fn().mockResolvedValue({
          ...operacaoBase,
          resultadoExecucao: 'REPARO_INICIADO',
        }),
      },
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      pendencias: {
        criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
      },
      mp,
    });
    await servico.executar('op1');
    expect(pendencias.criar).toHaveBeenCalled();
    expect(mp.estornarTotal).not.toHaveBeenCalled();
  });

  it('estorna integral quando paga e REPARO_NAO_INICIADO', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const mp = {
      estornarTotal: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: {
          id: 'ORD1',
          status: 'refunded',
          pagamentos: [],
          refundedAmount: 50,
        },
      }),
    };
    const { servico } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
      },
      mp,
    });
    await servico.executar('op1');
    expect(mp.estornarTotal).toHaveBeenCalled();
  });

  it('confirma cancelamento após 409 cannot_cancel_order quando GET confirma', async () => {
    const mp = {
      cancelarOrder: jest.fn().mockResolvedValue({
        tipo: 'conflito_especifico',
        codigo: 'cannot_cancel_order',
      }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: { id: 'ORD1', status: 'canceled', pagamentos: [] },
      }),
    };
    const { servico } = criarServico({
      mp,
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
      },
    });
    await servico.executar('op1');
    expect(mp.consultarOrder).toHaveBeenCalled();
  });

  it('trata MP indeterminado com adiamento e tentativas', async () => {
    const { servico, operacoes } = criarServico({
      mp: {
        cancelarOrder: jest
          .fn()
          .mockResolvedValue({ tipo: 'indeterminado', motivo: 'timeout' }),
      },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
  });

  it('reutiliza resultado terminal de cobrança já cancelada', async () => {
    const cancelada = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.CANCELADA,
    });
    const { servico, operacoes } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cancelada),
      },
    });
    await servico.executar('op1');
    expect(operacoes.concluir).toHaveBeenCalledWith(
      expect.anything(),
      'op1',
      expect.objectContaining({ resultado: 'CANCELADA' }),
    );
  });

  it('cancela cobrança em INTENCAO sem order ativa', async () => {
    const intencao = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.INTENCAO,
    });
    const { servico, cobrancas } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(intencao),
        buscarPorId: jest.fn().mockResolvedValue(intencao),
      },
      operacoesCriacao: {
        obterPorCobrancaId: jest
          .fn()
          .mockResolvedValue({ situacao: 'CONCLUIDA' }),
      },
    });
    await servico.executar('op1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('adia quando cobrança em INTENCAO com criação de order em andamento', async () => {
    const intencao = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.INTENCAO,
    });
    const { servico, operacoes } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(intencao),
        buscarPorId: jest.fn().mockResolvedValue(intencao),
      },
      operacoesCriacao: {
        obterPorCobrancaId: jest.fn().mockResolvedValue({
          situacao: 'EM_ANDAMENTO',
        }),
      },
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
  });

  it('abre pendência após esgotar tentativas MP em cobrança paga', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const { servico, pendencias } = criarServico({
      operacoes: {
        buscarPorId: jest.fn().mockResolvedValue({
          ...operacaoBase,
          tentativasMercadoPago: 4,
        }),
      },
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
      mp: {
        estornarTotal: jest
          .fn()
          .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
      },
      pendencias: {
        criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
      },
    });
    await servico.executar('op1');
    expect(pendencias.criar).toHaveBeenCalled();
  });

  it('estorno confirma por GET após order_already_refunded', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const mp = {
      estornarTotal: jest.fn().mockResolvedValue({
        tipo: 'conflito_especifico',
        codigo: 'order_already_refunded',
      }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: { id: 'ORD1', status: 'refunded', pagamentos: [] },
      }),
    };
    const { servico } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
      },
      mp,
    });
    await servico.executar('op1');
    expect(mp.consultarOrder).toHaveBeenCalled();
  });

  it('retentativa de estorno reutiliza a mesma chave MP persistida', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const estornarTotal = jest
      .fn()
      .mockResolvedValueOnce({ tipo: 'indeterminado', motivo: 'timeout' })
      .mockResolvedValueOnce({ tipo: 'sucesso' });
    const mp = {
      estornarTotal,
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: { id: 'ORD1', status: 'refunded', pagamentos: [] },
      }),
    };
    const operacoesComRetry: OperacaoFinanceiraGateway = {
      buscarPorId: jest
        .fn()
        .mockResolvedValueOnce({ ...operacaoBase, tentativasMercadoPago: 0 })
        .mockResolvedValueOnce({ ...operacaoBase, tentativasMercadoPago: 1 }),
      adiarProcessamento: jest.fn(),
      incrementarTentativasMercadoPago: jest.fn(),
      concluir: jest.fn(),
    } as unknown as OperacaoFinanceiraGateway;
    const servico = new ExecutarCancelamentoFinanceiroService(
      new UnitOfWorkFake(),
      operacoesComRetry,
      {
        buscarPorOrdemServicoERodadaLeitura: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
        atualizar: jest.fn(),
      } as never,
      { obterPorCobrancaId: jest.fn() } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
      } as never,
      mp as never,
      { criar: jest.fn() } as never,
      { registrar: jest.fn() } as never,
      100,
      5,
      50,
    );
    await servico.executar('op1');
    await servico.executar('op1');
    expect(estornarTotal).toHaveBeenCalledTimes(2);
    expect(estornarTotal).toHaveBeenNthCalledWith(1, 'ORD1', 'chave-mp');
    expect(estornarTotal).toHaveBeenNthCalledWith(2, 'ORD1', 'chave-mp');
  });

  it('409 refund_in_progress adia sem abrir pendência imediata', async () => {
    const mp = {
      cancelarOrder: jest.fn().mockResolvedValue({
        tipo: 'conflito_especifico',
        codigo: 'refund_in_progress',
      }),
    };
    const { servico, operacoes, pendencias } = criarServico({
      mp,
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
    expect(pendencias.criar).not.toHaveBeenCalled();
  });

  it('reutiliza terminal ESTORNADA sem chamar MP', async () => {
    const estornada = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.ESTORNADA,
    });
    const mp = { cancelarOrder: jest.fn(), estornarTotal: jest.fn() };
    const { servico, operacoes } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(estornada),
      },
      mp,
    });
    await servico.executar('op1');
    expect(operacoes.concluir).toHaveBeenCalledWith(
      expect.anything(),
      'op1',
      expect.objectContaining({ resultado: 'ESTORNADA' }),
    );
    expect(mp.estornarTotal).not.toHaveBeenCalled();
  });

  it('reutiliza terminal PENDENCIA_MANUAL', async () => {
    const pend = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PENDENCIA_MANUAL,
    });
    const { servico, operacoes } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(pend),
      },
    });
    await servico.executar('op1');
    expect(operacoes.concluir).toHaveBeenCalledWith(
      expect.anything(),
      'op1',
      expect.objectContaining({ resultado: 'PENDENCIA_MANUAL_ABERTA' }),
    );
  });

  it('cannot_cancel_order sem confirmação GET adia falha (D3.15)', async () => {
    const mp = {
      cancelarOrder: jest.fn().mockResolvedValue({
        tipo: 'conflito_especifico',
        codigo: 'cannot_cancel_order',
      }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: { id: 'ORD1', status: 'processed', pagamentos: [] },
      }),
    };
    const { servico, operacoes, pendencias } = criarServico({
      mp,
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
    expect(pendencias.criar).not.toHaveBeenCalled();
  });

  it('409 de cancelamento desconhecido não rotaciona chave', async () => {
    const cancelarOrder = jest.fn().mockResolvedValue({
      tipo: 'conflito_especifico',
      codigo: 'outro_codigo',
    });
    const { servico, operacoes } = criarServico({
      mp: { cancelarOrder, consultarOrder: jest.fn() },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
    });
    await servico.executar('op1');
    expect(cancelarOrder).toHaveBeenCalledWith('ORD1', 'chave-mp');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
  });

  it('estorna cobrança paga sem order local', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const { servico, cobrancas } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      orders: { buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null) },
    });
    await servico.executar('op1');
    expect(cobrancas.atualizar).toHaveBeenCalled();
  });

  it('estorno sucesso sem confirmação GET não conclui', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const mp = {
      estornarTotal: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'sucesso',
        order: { id: 'ORD1', status: 'processed', pagamentos: [] },
      }),
    };
    const { servico, operacoes } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
      mp,
    });
    await servico.executar('op1');
    expect(operacoes.concluir).not.toHaveBeenCalled();
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
  });

  it('confirmar cancelamento falha se consulta MP indeterminada', async () => {
    const mp = {
      cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      consultarOrder: jest.fn().mockResolvedValue({
        tipo: 'indeterminado',
        motivo: 'HTTP 503',
      }),
    };
    const { servico, operacoes } = criarServico({
      mp,
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
  });

  it('estorno movement_operations_pending adia', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const mp = {
      estornarTotal: jest.fn().mockResolvedValue({
        tipo: 'conflito_especifico',
        codigo: 'movement_operations_pending',
      }),
    };
    const { servico, operacoes } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
      mp,
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
  });

  it('estorno 409 desconhecido adia sem rotacionar chave', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const estornarTotal = jest.fn().mockResolvedValue({
      tipo: 'conflito_especifico',
      codigo: 'codigo_novo',
    });
    const { servico, operacoes } = criarServico({
      cobrancas: {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
      },
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
      mp: { estornarTotal, consultarOrder: jest.fn() },
    });
    await servico.executar('op1');
    expect(estornarTotal).toHaveBeenCalledWith('ORD1', 'chave-mp');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
  });

  it('movement_operations_pending no cancelamento adia', async () => {
    const mp = {
      cancelarOrder: jest.fn().mockResolvedValue({
        tipo: 'conflito_especifico',
        codigo: 'movement_operations_pending',
      }),
    };
    const { servico, operacoes } = criarServico({
      mp,
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
      },
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
    expect(operacoes.incrementarTentativasMercadoPago).toHaveBeenCalled();
  });

  it('adia quando orçamento em aprovação', async () => {
    const { servico, operacoes } = criarServico({
      orcamentos: {
        buscarPorOrdemServicoERodadaLeitura: jest.fn().mockResolvedValue({
          situacao: 'APROVACAO_EM_ANDAMENTO',
        }),
      },
    });
    await servico.executar('op1');
    expect(operacoes.adiarProcessamento).toHaveBeenCalled();
    expect(operacoes.concluir).not.toHaveBeenCalled();
  });
});
