import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import { SituacaoCobranca } from '@/modules/cobrancas/domain/situacao-cobranca';
import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import {
  EVENTO_ESTORNO_CONCLUIDO,
  EVENTO_PENDENCIA_RESOLVIDA,
} from '@/shared/messaging/envelope';
import {
  PendenciaEstornoJaResolvidaError,
  PendenciaEstornoNaoEncontradaError,
  PendenciaEstornoSemPagamentoError,
} from '../../domain/errors/pendencia.errors';
import { ResolverPendenciaEstornoUseCase } from './resolver-pendencia-estorno.use-case';

describe('ResolverPendenciaEstornoUseCase', () => {
  const cobranca = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 10_000,
    prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
    situacao: SituacaoCobranca.PENDENCIA_MANUAL,
  });

  it('lança quando pendência não existe', async () => {
    const caso = new ResolverPendenciaEstornoUseCase(
      new UnitOfWorkFake(),
      { buscarPorId: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      { registrar: jest.fn() },
      { buscarPorPendenciaId: jest.fn().mockResolvedValue(null) } as never,
    );
    await expect(
      caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'SEM_ESTORNO',
        justificativa: 'ok',
      }),
    ).rejects.toBeInstanceOf(PendenciaEstornoNaoEncontradaError);
  });

  it('rejeita pendência já resolvida', async () => {
    const caso = new ResolverPendenciaEstornoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue({
          id: 'p1',
          cobrancaId: 'c1',
          situacao: 'RESOLVIDA',
        }),
      } as never,
      {} as never,
      {} as never,
      { registrar: jest.fn() },
      { buscarPorPendenciaId: jest.fn().mockResolvedValue(null) } as never,
    );
    await expect(
      caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'SEM_ESTORNO',
      }),
    ).rejects.toBeInstanceOf(PendenciaEstornoJaResolvidaError);
  });

  it('publica pendencia resolvida e estorno concluído em estorno integral', async () => {
    const eventos: string[] = [];
    const caso = new ResolverPendenciaEstornoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue({
          id: 'p1',
          cobrancaId: 'c1',
          ordemServicoId: 'os1',
          rodada: 1,
          valorCobrancaCentavos: 10_000,
          situacao: 'ABERTA',
        }),
        resolver: jest.fn(),
      } as never,
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn(),
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          eventos.push(msg.eventType);
        }),
      },
      { buscarPorPendenciaId: jest.fn().mockResolvedValue(null) } as never,
    );
    await caso.execute({
      pendenciaId: 'p1',
      responsavelId: 'admin',
      decisao: 'ESTORNO_INTEGRAL',
      justificativa: 'cliente',
    });
    expect(eventos).toContain(EVENTO_PENDENCIA_RESOLVIDA);
    expect(eventos).toContain(EVENTO_ESTORNO_CONCLUIDO);
  });

  it('falha quando cobrança da pendência não existe', async () => {
    const caso = new ResolverPendenciaEstornoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue({
          id: 'p1',
          cobrancaId: 'c1',
          situacao: 'ABERTA',
        }),
      } as never,
      { buscarPorId: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { registrar: jest.fn() },
      { buscarPorPendenciaId: jest.fn().mockResolvedValue(null) } as never,
    );
    await expect(
      caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'SEM_ESTORNO',
      }),
    ).rejects.toBeInstanceOf(PendenciaEstornoNaoEncontradaError);
  });

  it('SEM_ESTORNO publica só pendência resolvida', async () => {
    const eventos: string[] = [];
    const caso = new ResolverPendenciaEstornoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue({
          id: 'p1',
          cobrancaId: 'c1',
          ordemServicoId: 'os1',
          rodada: 1,
          valorCobrancaCentavos: 10_000,
          situacao: 'ABERTA',
        }),
        resolver: jest.fn(),
      } as never,
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {} as never,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          eventos.push(msg.eventType);
        }),
      },
      { buscarPorPendenciaId: jest.fn().mockResolvedValue(null) } as never,
    );
    await caso.execute({
      pendenciaId: 'p1',
      responsavelId: 'admin',
      decisao: 'SEM_ESTORNO',
      justificativa: 'sem devolução',
    });
    expect(eventos).toContain(EVENTO_PENDENCIA_RESOLVIDA);
    expect(eventos).not.toContain(EVENTO_ESTORNO_CONCLUIDO);
  });

  it('exige valor para ESTORNO_PARCIAL', async () => {
    const caso = new ResolverPendenciaEstornoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue({
          id: 'p1',
          cobrancaId: 'c1',
          valorCobrancaCentavos: 10_000,
          situacao: 'ABERTA',
        }),
      } as never,
      { buscarPorId: jest.fn().mockResolvedValue(cobranca) } as never,
      {} as never,
      { registrar: jest.fn() },
      { buscarPorPendenciaId: jest.fn().mockResolvedValue(null) } as never,
    );
    await expect(
      caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_PARCIAL',
      }),
    ).rejects.toThrow('Valor estornado é obrigatório');
  });

  it('publica estorno parcial com valor informado', async () => {
    const eventos: string[] = [];
    const caso = new ResolverPendenciaEstornoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue({
          id: 'p1',
          cobrancaId: 'c1',
          ordemServicoId: 'os1',
          rodada: 1,
          valorCobrancaCentavos: 10_000,
          situacao: 'ABERTA',
        }),
        resolver: jest.fn(),
      } as never,
      {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          eventos.push(msg.eventType);
        }),
      },
      { buscarPorPendenciaId: jest.fn().mockResolvedValue(null) } as never,
    );
    await caso.execute({
      pendenciaId: 'p1',
      responsavelId: 'admin',
      decisao: 'ESTORNO_PARCIAL',
      valorEstornadoCentavos: 3_000,
      justificativa: 'peça não usada',
    });
    expect(eventos).toContain(EVENTO_ESTORNO_CONCLUIDO);
  });

  describe('origem e order do EstornoConcluido', () => {
    function montar(estornoAutomatico: unknown) {
      const mensagens: Array<{ eventType: string; envelope: any }> = [];
      const cobrancas = {
        buscarPorId: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      };
      const orders = {
        buscarQueConfirmouPagamento: jest
          .fn()
          .mockResolvedValue({ mercadoPagoOrderId: 'ORD-LEGITIMA' }),
        desativar: jest.fn(),
      };
      const caso = new ResolverPendenciaEstornoUseCase(
        new UnitOfWorkFake(),
        {
          buscarPorId: jest.fn().mockResolvedValue({
            id: 'p1',
            cobrancaId: 'c1',
            ordemServicoId: 'os1',
            rodada: 1,
            valorCobrancaCentavos: 10_000,
            situacao: 'ABERTA',
          }),
          resolver: jest.fn(),
        } as never,
        cobrancas as never,
        orders as never,
        {
          registrar: jest.fn(async (_ctx, msg) => {
            mensagens.push(msg);
          }),
        },
        {
          buscarPorPendenciaId: jest.fn().mockResolvedValue(estornoAutomatico),
        } as never,
      );
      return { caso, mensagens, cobrancas, orders };
    }

    const estornoDoSegundoPagamento = {
      id: 'e1',
      orderMercadoPagoId: 'omp2',
      mercadoPagoOrderId: 'ORD-SEGUNDA',
    };

    it('preenche origemEstorno com PENDENCIA_RESOLVIDA', async () => {
      const { caso, mensagens } = montar(null);

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_INTEGRAL',
      });

      const estorno = mensagens.find(
        (m) => m.eventType === EVENTO_ESTORNO_CONCLUIDO,
      );
      expect(estorno?.envelope.payload).toMatchObject({
        orderId: 'ORD-LEGITIMA',
        tipoEstorno: 'INTEGRAL',
        origemEstorno: 'PENDENCIA_RESOLVIDA',
      });
    });

    it('preenche origemEstorno também no estorno parcial', async () => {
      const { caso, mensagens } = montar(null);

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_PARCIAL',
        valorEstornadoCentavos: 4000,
      });

      const estorno = mensagens.find(
        (m) => m.eventType === EVENTO_ESTORNO_CONCLUIDO,
      );
      expect(estorno?.envelope.payload).toMatchObject({
        tipoEstorno: 'PARCIAL',
        valorEstornadoCentavos: 4000,
        origemEstorno: 'PENDENCIA_RESOLVIDA',
      });
    });

    it('pendência de estorno automático informa a order estornada, não a legítima', async () => {
      const { caso, mensagens } = montar(estornoDoSegundoPagamento);

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_INTEGRAL',
      });

      const estorno = mensagens.find(
        (m) => m.eventType === EVENTO_ESTORNO_CONCLUIDO,
      );
      expect(estorno?.envelope.payload.orderId).toBe('ORD-SEGUNDA');
    });

    it('pendência de estorno automático não altera a situação da cobrança legítima', async () => {
      const { caso, cobrancas } = montar(estornoDoSegundoPagamento);

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_INTEGRAL',
      });

      expect(cobrancas.atualizar).not.toHaveBeenCalled();
    });

    it.each(['ESTORNO_INTEGRAL', 'SEM_ESTORNO'] as const)(
      'pendência de estorno automático resolvida com %s desativa a order estornada',
      async (decisao) => {
        const { caso, orders } = montar(estornoDoSegundoPagamento);

        await caso.execute({
          pendenciaId: 'p1',
          responsavelId: 'admin',
          decisao,
        });

        expect(orders.desativar).toHaveBeenCalledWith(
          expect.anything(),
          'omp2',
        );
      },
    );

    it('pendência da cobrança não desativa nenhuma order', async () => {
      const { caso, orders } = montar(null);

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_INTEGRAL',
      });

      expect(orders.desativar).not.toHaveBeenCalled();
    });

    it('pendência da cobrança marca a cobrança como estornada', async () => {
      const { caso, cobrancas } = montar(null);

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_INTEGRAL',
      });

      const [, , gravada] = cobrancas.atualizar.mock.calls[0];
      expect(gravada.situacao).toBe(SituacaoCobranca.ESTORNADA);
    });
  });

  describe('cobrança sem pagamento confirmado', () => {
    function montar(situacao: SituacaoCobranca, estornoAutomatico: unknown) {
      const semPagamento = new Cobranca({
        id: 'c1',
        orcamentoId: 'o1',
        ordemServicoId: 'os1',
        rodada: 1,
        clienteId: 'cl1',
        correlationId: 'corr',
        valorTotalCentavos: 10_000,
        prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
        situacao,
      });
      const resolver = jest.fn();
      const registrar = jest.fn();
      const caso = new ResolverPendenciaEstornoUseCase(
        new UnitOfWorkFake(),
        {
          buscarPorId: jest.fn().mockResolvedValue({
            id: 'p1',
            cobrancaId: 'c1',
            ordemServicoId: 'os1',
            rodada: 1,
            valorCobrancaCentavos: 10_000,
            situacao: 'ABERTA',
          }),
          resolver,
        } as never,
        {
          buscarPorId: jest.fn().mockResolvedValue(semPagamento),
          atualizar: jest.fn(),
        } as never,
        {
          buscarQueConfirmouPagamento: jest
            .fn()
            .mockResolvedValue({ mercadoPagoOrderId: 'ORD1' }),
          desativar: jest.fn(),
        } as never,
        { registrar },
        {
          buscarPorPendenciaId: jest.fn().mockResolvedValue(estornoAutomatico),
        } as never,
      );
      return { caso, resolver, registrar };
    }

    it.each([
      SituacaoCobranca.INTENCAO,
      SituacaoCobranca.PENDENTE,
      SituacaoCobranca.EXPIRADA,
    ])(
      'cobrança %s: ESTORNO_INTEGRAL e ESTORNO_PARCIAL são recusados sem efeito nem EstornoConcluido',
      async (situacao) => {
        const { caso, resolver, registrar } = montar(situacao, null);

        for (const decisao of [
          'ESTORNO_INTEGRAL',
          'ESTORNO_PARCIAL',
        ] as const) {
          await expect(
            caso.execute({
              pendenciaId: 'p1',
              responsavelId: 'admin',
              decisao,
              valorEstornadoCentavos: 1000,
            }),
          ).rejects.toBeInstanceOf(PendenciaEstornoSemPagamentoError);
        }

        expect(resolver).not.toHaveBeenCalled();
        expect(registrar).not.toHaveBeenCalled();
      },
    );

    it('SEM_ESTORNO continua permitido', async () => {
      const { caso, resolver } = montar(SituacaoCobranca.PENDENTE, null);

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'SEM_ESTORNO',
        justificativa: 'sem pagamento',
      });

      expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('pendência de estorno automático permite estornar mesmo com a cobrança sem pagamento confirmado', async () => {
      const { caso, registrar } = montar(SituacaoCobranca.EXPIRADA, {
        id: 'e1',
        orderMercadoPagoId: 'omp-tardia',
        mercadoPagoOrderId: 'ORD-TARDIA',
      });

      await caso.execute({
        pendenciaId: 'p1',
        responsavelId: 'admin',
        decisao: 'ESTORNO_INTEGRAL',
      });

      expect(registrar).toHaveBeenCalledTimes(2);
    });
  });
});
