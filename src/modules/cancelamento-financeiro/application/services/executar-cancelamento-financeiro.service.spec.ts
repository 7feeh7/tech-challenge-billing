import { Logger } from '@nestjs/common';
import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import type { EstornoAutomaticoGateway } from '@/modules/cobrancas/application/ports/estorno-automatico.gateway';
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
  estornosAutomaticos?: Partial<EstornoAutomaticoGateway>;
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
    buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
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
      buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(null),
      marcarConfirmouPagamento: jest.fn(),
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
    (deps.estornosAutomaticos ?? {
      buscarPorOrderMercadoPagoId: jest.fn().mockResolvedValue(null),
    }) as EstornoAutomaticoGateway,
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
      },
      mp,
    });
    await servico.executar('op1');
    expect(pendencias.criar).toHaveBeenCalled();
    expect(mp.estornarTotal).not.toHaveBeenCalled();
  });

  describe('sinais de log estruturado', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      warn.mockRestore();
    });

    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });

    function sinaisEmitidos(): Record<string, unknown>[] {
      return warn.mock.calls.map(([mensagem]) => JSON.parse(mensagem));
    }

    it('emite um único billing.pendencia_estorno_aberta ao abrir pendência por reparo iniciado', async () => {
      const { servico } = criarServico({
        operacoes: {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoBase,
            resultadoExecucao: 'REPARO_INICIADO',
          }),
        },
        cobrancas: {
          buscarPorOrdemServicoERodada: jest
            .fn()
            .mockResolvedValue(cobrancaPaga),
        },
        pendencias: {
          criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
          buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
        },
      });

      await servico.executar('op1');

      expect(sinaisEmitidos()).toEqual([
        {
          metric: 'billing.pendencia_estorno_aberta',
          ordemServicoId: 'os1',
          rodada: 1,
          correlationId: 'corr',
          operacaoId: 'op1',
          cobrancaId: 'c1',
          motivo: 'reparo_iniciado',
        },
      ]);
    });

    it('emite billing.operacao_financeira_indeterminada e billing.pendencia_estorno_aberta ao esgotar tentativas do MP', async () => {
      const { servico } = criarServico({
        operacoes: {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoBase,
            tentativasMercadoPago: 4,
          }),
        },
        cobrancas: {
          buscarPorOrdemServicoERodada: jest
            .fn()
            .mockResolvedValue(cobrancaPaga),
          buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
        },
        orders: {
          buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
            id: 'omp1',
            mercadoPagoOrderId: 'ORD1',
          }),
          buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
            id: 'omp1',
            mercadoPagoOrderId: 'ORD1',
          }),
          marcarConfirmouPagamento: jest.fn(),
        },
        mp: {
          estornarTotal: jest
            .fn()
            .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
        },
        pendencias: {
          criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
          buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
        },
      });

      await servico.executar('op1');

      const contexto = {
        ordemServicoId: 'os1',
        rodada: 1,
        correlationId: 'corr',
        operacaoId: 'op1',
        cobrancaId: 'c1',
      };
      expect(sinaisEmitidos()).toEqual([
        {
          metric: 'billing.operacao_financeira_indeterminada',
          ...contexto,
          motivo: 'tentativas_esgotadas',
        },
        {
          metric: 'billing.pendencia_estorno_aberta',
          ...contexto,
          motivo: 'operacao_indeterminada',
        },
      ]);
    });

    it('não emite sinal enquanto as tentativas do MP não se esgotam', async () => {
      const { servico } = criarServico({
        cobrancas: {
          buscarPorOrdemServicoERodada: jest
            .fn()
            .mockResolvedValue(cobrancaPaga),
        },
        orders: {
          buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
            id: 'omp1',
            mercadoPagoOrderId: 'ORD1',
          }),
          buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
            id: 'omp1',
            mercadoPagoOrderId: 'ORD1',
          }),
          marcarConfirmouPagamento: jest.fn(),
        },
        mp: {
          estornarTotal: jest
            .fn()
            .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
        },
      });

      await servico.executar('op1');

      expect(warn).not.toHaveBeenCalled();
    });

    it('não repete o sinal ao reprocessar operação cuja pendência já foi aberta', async () => {
      const cobrancaComPendencia = new Cobranca({
        ...cobrancaPaga,
        situacao: SituacaoCobranca.PENDENCIA_MANUAL,
      });
      const { servico, pendencias } = criarServico({
        operacoes: {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoBase,
            tentativasMercadoPago: 4,
          }),
        },
        cobrancas: {
          buscarPorOrdemServicoERodada: jest
            .fn()
            .mockResolvedValue(cobrancaComPendencia),
        },
      });

      await servico.executar('op1');

      expect(pendencias.criar).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
      },
      mp: {
        estornarTotal: jest
          .fn()
          .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
      },
      pendencias: {
        criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
        buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
        desativar: jest.fn(),
      } as never,
      mp as never,
      {
        criar: jest.fn(),
        buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
      } as never,
      { registrar: jest.fn() } as never,
      100,
      5,
      50,
      {
        buscarPorOrderMercadoPagoId: jest.fn().mockResolvedValue(null),
      } as never,
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
      orders: {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(null),
        marcarConfirmouPagamento: jest.fn(),
      },
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          id: 'omp1',
          mercadoPagoOrderId: 'ORD1',
        }),
        marcarConfirmouPagamento: jest.fn(),
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

  describe('cobrança EXPIRADA', () => {
    const cobrancaExpirada = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.EXPIRADA,
    });
    const orderAtiva = { id: 'omp1', mercadoPagoOrderId: 'ORD1' };

    function criarServicoComCobrancaExpirada(
      deps: Parameters<typeof criarServico>[0] = {},
    ) {
      return criarServico({
        ...deps,
        cobrancas: {
          buscarPorOrdemServicoERodada: jest
            .fn()
            .mockResolvedValue(cobrancaExpirada),
          buscarPorId: jest.fn().mockResolvedValue(cobrancaExpirada),
          atualizar: jest.fn(),
        },
      });
    }

    it('conclui como CANCELADA sem order ativa e sem chamar o Mercado Pago', async () => {
      const mp = { cancelarOrder: jest.fn(), consultarOrder: jest.fn() };
      const { servico, operacoes, cobrancas, outboxRegistros } =
        criarServicoComCobrancaExpirada({ mp });

      await servico.executar('op1');

      expect(operacoes.concluir).toHaveBeenCalledWith(
        expect.anything(),
        'op1',
        expect.objectContaining({
          cobrancaId: 'c1',
          resultado: 'CANCELADA',
          pendenciaId: null,
        }),
      );
      expect(outboxRegistros).toEqual([EVENTO_RESPOSTA_CANCELAMENTO]);
      expect(cobrancas.atualizar).not.toHaveBeenCalled();
      expect(mp.cancelarOrder).not.toHaveBeenCalled();
    });

    it('cancela a order ativa e conclui como CANCELADA', async () => {
      const mp = {
        cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: { id: 'ORD1', status: 'canceled', pagamentos: [] },
        }),
      };
      const orders = {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderAtiva),
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(orderAtiva),
        marcarConfirmouPagamento: jest.fn(),
        desativar: jest.fn(),
      };
      const { servico, operacoes, cobrancas, outboxRegistros } =
        criarServicoComCobrancaExpirada({ mp, orders });

      await servico.executar('op1');

      expect(mp.cancelarOrder).toHaveBeenCalledWith('ORD1', 'chave-mp');
      expect(orders.desativar).toHaveBeenCalledWith(expect.anything(), 'omp1');
      expect(cobrancas.atualizar).not.toHaveBeenCalled();
      expect(operacoes.concluir).toHaveBeenCalledWith(
        expect.anything(),
        'op1',
        expect.objectContaining({ resultado: 'CANCELADA' }),
      );
      expect(outboxRegistros).toEqual([EVENTO_RESPOSTA_CANCELAMENTO]);
    });

    it.each([
      ['canceled', undefined],
      ['expired', undefined],
      ['canceled', 'expired'],
    ])(
      'após 409 cannot_cancel_order conclui como CANCELADA quando a consulta devolve status %s e detalhe %s',
      async (status, statusDetail) => {
        const mp = {
          cancelarOrder: jest.fn().mockResolvedValue({
            tipo: 'conflito_especifico',
            codigo: 'cannot_cancel_order',
          }),
          consultarOrder: jest.fn().mockResolvedValue({
            tipo: 'sucesso',
            order: { id: 'ORD1', status, statusDetail, pagamentos: [] },
          }),
        };
        const orders = {
          buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderAtiva),
          buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(orderAtiva),
          marcarConfirmouPagamento: jest.fn(),
          desativar: jest.fn(),
        };
        const { servico, operacoes, cobrancas, outboxRegistros } =
          criarServicoComCobrancaExpirada({ mp, orders });

        await servico.executar('op1');

        expect(mp.consultarOrder).toHaveBeenCalledWith('ORD1');
        expect(cobrancas.atualizar).not.toHaveBeenCalled();
        expect(operacoes.concluir).toHaveBeenCalledWith(
          expect.anything(),
          'op1',
          expect.objectContaining({ resultado: 'CANCELADA' }),
        );
        expect(outboxRegistros).toEqual([EVENTO_RESPOSTA_CANCELAMENTO]);
      },
    );

    it('não conclui como CANCELADA quando a consulta após o 409 mostra order paga', async () => {
      const mp = {
        cancelarOrder: jest.fn().mockResolvedValue({
          tipo: 'conflito_especifico',
          codigo: 'cannot_cancel_order',
        }),
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: {
            id: 'ORD1',
            status: 'processed',
            pagamentos: [{ id: 'PAY1', status: 'approved' }],
          },
        }),
      };
      const { servico, operacoes, outboxRegistros } =
        criarServicoComCobrancaExpirada({
          mp,
          orders: {
            buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderAtiva),
            buscarQueConfirmouPagamento: jest
              .fn()
              .mockResolvedValue(orderAtiva),
            marcarConfirmouPagamento: jest.fn(),
          },
        });

      await servico.executar('op1');

      expect(operacoes.concluir).not.toHaveBeenCalled();
      expect(operacoes.adiarProcessamento).toHaveBeenCalled();
      expect(outboxRegistros).toEqual([]);
    });

    it('reprocessar a operação já concluída não cancela nem responde de novo', async () => {
      let situacao: 'EM_ANDAMENTO' | 'CONCLUIDA' = 'EM_ANDAMENTO';
      const mp = {
        cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: { id: 'ORD1', status: 'canceled', pagamentos: [] },
        }),
      };
      const { servico, operacoes, outboxRegistros } =
        criarServicoComCobrancaExpirada({
          mp,
          operacoes: {
            buscarPorId: jest.fn(async () => ({ ...operacaoBase, situacao })),
            concluir: jest.fn(async () => {
              situacao = 'CONCLUIDA';
            }),
          },
          orders: {
            buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderAtiva),
            buscarQueConfirmouPagamento: jest
              .fn()
              .mockResolvedValue(orderAtiva),
            marcarConfirmouPagamento: jest.fn(),
            desativar: jest.fn(),
          },
        });

      await servico.executar('op1');
      await servico.executar('op1');

      expect(operacoes.concluir).toHaveBeenCalledTimes(1);
      expect(mp.cancelarOrder).toHaveBeenCalledTimes(1);
      expect(outboxRegistros).toEqual([EVENTO_RESPOSTA_CANCELAMENTO]);
    });
  });

  describe('estorno parado em ESTORNO_EM_ANDAMENTO', () => {
    const cobrancaEstornando = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
      pagamentoConfirmadoEm: new Date('2026-11-15T12:00:00.000Z'),
    });
    const orderLegitima = {
      id: 'omp1',
      mercadoPagoOrderId: 'ORD1',
      confirmouPagamento: true,
    };
    const orderEstornada = {
      tipo: 'sucesso',
      order: { id: 'ORD1', status: 'refunded', pagamentos: [] },
    };
    const orderPaga = {
      tipo: 'sucesso',
      order: { id: 'ORD1', status: 'processed', pagamentos: [] },
    };

    function montar(opcoes: {
      consultas: unknown[];
      tentativasMercadoPago?: number;
      estornarTotal?: unknown;
    }) {
      const consultarOrder = jest.fn();
      for (const consulta of opcoes.consultas) {
        consultarOrder.mockResolvedValueOnce(consulta);
      }
      const estornarTotal = jest
        .fn()
        .mockResolvedValue(opcoes.estornarTotal ?? { tipo: 'sucesso' });
      const desativar = jest.fn();
      const criacao = criarServico({
        operacoes: {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoBase,
            tentativasMercadoPago: opcoes.tentativasMercadoPago ?? 0,
          }),
        },
        cobrancas: {
          buscarPorOrdemServicoERodada: jest
            .fn()
            .mockResolvedValue(cobrancaEstornando),
          buscarPorId: jest.fn().mockResolvedValue(cobrancaEstornando),
        },
        orders: {
          buscarQueConfirmouPagamento: jest
            .fn()
            .mockResolvedValue(orderLegitima),
          marcarConfirmouPagamento: jest.fn(),
          desativar,
        },
        mp: { consultarOrder, estornarTotal },
        pendencias: {
          criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
          buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
        },
      });
      return { ...criacao, consultarOrder, estornarTotal, desativar };
    }

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('com estorno integral confirmado conclui a operação com ESTORNADA sem repetir o pedido', async () => {
      const { servico, estornarTotal, operacoes, cobrancas, desativar } =
        montar({ consultas: [orderEstornada] });

      await servico.executar('op1');

      expect(estornarTotal).not.toHaveBeenCalled();
      const [, , gravada] = (cobrancas.atualizar as jest.Mock).mock.calls[0];
      expect(gravada.situacao).toBe(SituacaoCobranca.ESTORNADA);
      expect(desativar).toHaveBeenCalledWith(expect.anything(), 'omp1');
      expect(operacoes.concluir).toHaveBeenCalledWith(
        expect.anything(),
        'op1',
        { cobrancaId: 'c1', resultado: 'ESTORNADA', pendenciaId: null },
      );
    });

    it('sem estorno repete o pedido com a mesma chave de idempotência da operação', async () => {
      const { servico, estornarTotal, operacoes } = montar({
        consultas: [orderPaga, orderEstornada],
      });

      await servico.executar('op1');

      expect(estornarTotal).toHaveBeenCalledWith('ORD1', 'chave-mp');
      expect(operacoes.concluir).toHaveBeenCalledWith(
        expect.anything(),
        'op1',
        expect.objectContaining({ resultado: 'ESTORNADA' }),
      );
    });

    it('ainda indeterminado antes do máximo de tentativas adia e não responde ao OS', async () => {
      const { servico, operacoes, outboxRegistros } = montar({
        consultas: [orderPaga, orderPaga],
        tentativasMercadoPago: 1,
      });

      await servico.executar('op1');

      expect(operacoes.incrementarTentativasMercadoPago).toHaveBeenCalledWith(
        'op1',
      );
      expect(operacoes.adiarProcessamento).toHaveBeenCalled();
      expect(operacoes.concluir).not.toHaveBeenCalled();
      expect(outboxRegistros).toHaveLength(0);
    });

    it('ainda indeterminado no máximo de tentativas abre pendência manual, responde PENDENCIA_MANUAL_ABERTA e emite o sinal', async () => {
      const { servico, operacoes, pendencias, cobrancas } = montar({
        consultas: [orderPaga, orderPaga],
        tentativasMercadoPago: 4,
      });

      await servico.executar('op1');

      expect(pendencias.criar).toHaveBeenCalledTimes(1);
      const [, , gravada] = (cobrancas.atualizar as jest.Mock).mock.calls.at(
        -1,
      );
      expect(gravada.situacao).toBe(SituacaoCobranca.PENDENCIA_MANUAL);
      expect(operacoes.concluir).toHaveBeenCalledWith(
        expect.anything(),
        'op1',
        {
          cobrancaId: 'c1',
          resultado: 'PENDENCIA_MANUAL_ABERTA',
          pendenciaId: 'pend1',
        },
      );
      const metricas = (Logger.prototype.warn as jest.Mock).mock.calls.map(
        ([mensagem]) => JSON.parse(mensagem).metric,
      );
      expect(metricas).toContain('billing.operacao_financeira_indeterminada');
    });

    it('estorna a order que confirmou o pagamento, nunca outra da cobrança', async () => {
      const { servico, estornarTotal } = montar({
        consultas: [orderPaga, orderEstornada],
      });

      await servico.executar('op1');

      expect(estornarTotal).toHaveBeenCalledTimes(1);
      expect(estornarTotal.mock.calls[0][0]).toBe('ORD1');
    });
  });

  describe('pendência manual de cobrança ainda sem pagamento confirmado', () => {
    const orderAtiva = { id: 'omp1', mercadoPagoOrderId: 'ORD1' };
    const consultaPaga = {
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
    };

    function montar(
      situacao: SituacaoCobranca,
      consulta: unknown = consultaPaga,
      estornosAutomaticos?: Partial<EstornoAutomaticoGateway>,
    ) {
      const cobranca = new Cobranca({ ...cobrancaPendente, situacao });
      const marcarConfirmouPagamento = jest.fn();
      const criacao = criarServico({
        operacoes: {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoBase,
            tentativasMercadoPago: 4,
          }),
        },
        cobrancas: {
          buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
          buscarPorId: jest.fn().mockResolvedValue(cobranca),
        },
        orders: {
          buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderAtiva),
          buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(orderAtiva),
          marcarConfirmouPagamento,
          desativar: jest.fn(),
        },
        mp: {
          cancelarOrder: jest
            .fn()
            .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
          consultarOrder: jest.fn().mockResolvedValue(consulta),
        },
        pendencias: {
          criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
          buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
        },
        estornosAutomaticos,
      });
      return { ...criacao, marcarConfirmouPagamento };
    }

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each([SituacaoCobranca.PENDENTE, SituacaoCobranca.EXPIRADA])(
      'cobrança %s com pagamento revelado abre a pendência sem lançar erro e responde ao OS',
      async (situacao) => {
        const { servico, operacoes, cobrancas, marcarConfirmouPagamento } =
          montar(situacao);

        await servico.executar('op1');

        const [, , gravada] = (cobrancas.atualizar as jest.Mock).mock.calls[0];
        expect(gravada.situacao).toBe(SituacaoCobranca.PENDENCIA_MANUAL);
        expect(gravada.pagamentoConfirmadoEm).toEqual(
          new Date('2026-11-15T12:00:00.000Z'),
        );
        expect(marcarConfirmouPagamento).toHaveBeenCalledWith(
          expect.anything(),
          'omp1',
        );
        expect(operacoes.concluir).toHaveBeenCalledWith(
          expect.anything(),
          'op1',
          expect.objectContaining({
            resultado: 'PENDENCIA_MANUAL_ABERTA',
            pendenciaId: 'pend1',
          }),
        );
      },
    );

    it.each([
      SituacaoCobranca.INTENCAO,
      SituacaoCobranca.PENDENTE,
      SituacaoCobranca.EXPIRADA,
    ])(
      'cobrança %s sem pagamento revelado abre a pendência, responde ao OS e não muda de situação',
      async (situacao) => {
        const {
          servico,
          operacoes,
          cobrancas,
          marcarConfirmouPagamento,
          pendencias,
        } = montar(situacao, { tipo: 'indeterminado', motivo: 'timeout' });

        await servico.executar('op1');

        expect(pendencias.criar).toHaveBeenCalledTimes(1);
        expect(cobrancas.atualizar).not.toHaveBeenCalled();
        expect(marcarConfirmouPagamento).not.toHaveBeenCalled();
        expect(operacoes.concluir).toHaveBeenCalledWith(
          expect.anything(),
          'op1',
          {
            cobrancaId: 'c1',
            resultado: 'PENDENCIA_MANUAL_ABERTA',
            pendenciaId: 'pend1',
          },
        );
      },
    );

    it('reprocesso reaproveita a pendência aberta em vez de abrir outra', async () => {
      const { servico, operacoes, pendencias } = montar(
        SituacaoCobranca.PENDENTE,
        { tipo: 'indeterminado', motivo: 'timeout' },
      );
      (pendencias.buscarAbertaPorCobrancaId as jest.Mock).mockResolvedValue({
        id: 'pend-existente',
      });

      await servico.executar('op1');

      expect(pendencias.criar).not.toHaveBeenCalled();
      expect(operacoes.concluir).toHaveBeenCalledWith(
        expect.anything(),
        'op1',
        expect.objectContaining({ pendenciaId: 'pend-existente' }),
      );
    });

    it.each([SituacaoCobranca.PENDENTE, SituacaoCobranca.EXPIRADA])(
      'reprocesso que revela o pagamento (%s) reaproveita a pendência aberta e aplica a situação coerente',
      async (situacao) => {
        const {
          servico,
          operacoes,
          cobrancas,
          pendencias,
          marcarConfirmouPagamento,
        } = montar(situacao);
        (pendencias.buscarAbertaPorCobrancaId as jest.Mock).mockResolvedValue({
          id: 'pend-existente',
        });

        await servico.executar('op1');

        expect(pendencias.criar).not.toHaveBeenCalled();
        const [, , gravada] = (cobrancas.atualizar as jest.Mock).mock.calls[0];
        expect(gravada.situacao).toBe(SituacaoCobranca.PENDENCIA_MANUAL);
        expect(gravada.pagamentoConfirmadoEm).toEqual(
          new Date('2026-11-15T12:00:00.000Z'),
        );
        expect(marcarConfirmouPagamento).toHaveBeenCalledWith(
          expect.anything(),
          'omp1',
        );
        expect(operacoes.concluir).toHaveBeenCalledWith(
          expect.anything(),
          'op1',
          expect.objectContaining({ pendenciaId: 'pend-existente' }),
        );
      },
    );

    describe('order com estorno automático', () => {
      it('estorno em andamento: o cancelamento espera, sem cancelar a order nem abrir pendência', async () => {
        const buscarPorOrderMercadoPagoId = jest
          .fn()
          .mockResolvedValue({ situacao: 'EM_ANDAMENTO' });
        const { servico, operacoes, pendencias } = montar(
          SituacaoCobranca.EXPIRADA,
          consultaPaga,
          { buscarPorOrderMercadoPagoId },
        );

        await servico.executar('op1');

        expect(buscarPorOrderMercadoPagoId).toHaveBeenCalledWith('omp1');
        expect(operacoes.adiarProcessamento).toHaveBeenCalled();
        expect(
          operacoes.incrementarTentativasMercadoPago,
        ).not.toHaveBeenCalled();
        expect(operacoes.concluir).not.toHaveBeenCalled();
        expect(pendencias.criar).not.toHaveBeenCalled();
      });

      it('estorno com pendência manual: responde com a pendência existente, sem abrir outra', async () => {
        const { servico, operacoes, pendencias, cobrancas } = montar(
          SituacaoCobranca.EXPIRADA,
          consultaPaga,
          {
            buscarPorOrderMercadoPagoId: jest.fn().mockResolvedValue({
              situacao: 'PENDENCIA_MANUAL',
              pendenciaId: 'pend-do-estorno',
            }),
          },
        );

        await servico.executar('op1');

        expect(operacoes.concluir).toHaveBeenCalledWith(
          expect.anything(),
          'op1',
          {
            cobrancaId: 'c1',
            resultado: 'PENDENCIA_MANUAL_ABERTA',
            pendenciaId: 'pend-do-estorno',
          },
        );
        expect(pendencias.criar).not.toHaveBeenCalled();
        expect(cobrancas.atualizar).not.toHaveBeenCalled();
      });

      it('nunca trata a order em estorno como pagamento revelado, mesmo se o registro aparecer depois do ciclo', async () => {
        const buscarPorOrderMercadoPagoId = jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ situacao: 'EM_ANDAMENTO' });
        const { servico, cobrancas, marcarConfirmouPagamento } = montar(
          SituacaoCobranca.EXPIRADA,
          consultaPaga,
          { buscarPorOrderMercadoPagoId },
        );

        await servico.executar('op1');

        expect(marcarConfirmouPagamento).not.toHaveBeenCalled();
        const gravada = (cobrancas.atualizar as jest.Mock).mock.calls.at(
          -1,
        )?.[2];
        expect(gravada?.situacao ?? SituacaoCobranca.EXPIRADA).toBe(
          SituacaoCobranca.EXPIRADA,
        );
      });

      it('estorno já concluído não espera nem responde pela pendência do estorno', async () => {
        const { servico, operacoes } = montar(
          SituacaoCobranca.EXPIRADA,
          consultaPaga,
          {
            buscarPorOrderMercadoPagoId: jest.fn().mockResolvedValue({
              situacao: 'CONCLUIDO',
              pendenciaId: 'pend-do-estorno',
            }),
          },
        );

        await servico.executar('op1');

        expect(operacoes.adiarProcessamento).not.toHaveBeenCalled();
        expect(operacoes.concluir).not.toHaveBeenCalledWith(
          expect.anything(),
          'op1',
          expect.objectContaining({ pendenciaId: 'pend-do-estorno' }),
        );
      });
    });

    it('sem order ativa abre a pendência sem consultar o Mercado Pago', async () => {
      const cobranca = new Cobranca({
        ...cobrancaPendente,
        situacao: SituacaoCobranca.PENDENTE,
      });
      const consultarOrder = jest.fn();
      const { servico, operacoes } = criarServico({
        operacoes: {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoBase,
            tentativasMercadoPago: 4,
          }),
        },
        cobrancas: {
          buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
          buscarPorId: jest.fn().mockResolvedValue(cobranca),
        },
        orders: {
          buscarAtivaPorCobrancaId: jest
            .fn()
            .mockResolvedValueOnce(orderAtiva)
            .mockResolvedValue(null),
          buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(null),
          marcarConfirmouPagamento: jest.fn(),
          desativar: jest.fn(),
        },
        mp: {
          cancelarOrder: jest
            .fn()
            .mockResolvedValue({ tipo: 'indeterminado', motivo: 'x' }),
          consultarOrder,
        },
        pendencias: {
          criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
          buscarAbertaPorCobrancaId: jest.fn().mockResolvedValue(null),
        },
      });

      await servico.executar('op1');

      expect(consultarOrder).not.toHaveBeenCalled();
      expect(operacoes.concluir).toHaveBeenCalled();
    });
  });
});
