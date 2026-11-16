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
        buscarUltimaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          eventos.push(msg.eventType);
        }),
      },
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
        buscarUltimaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        registrar: jest.fn(async (_ctx, msg) => {
          eventos.push(msg.eventType);
        }),
      },
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
});
