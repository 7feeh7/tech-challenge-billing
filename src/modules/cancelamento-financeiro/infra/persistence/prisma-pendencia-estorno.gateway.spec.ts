import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaPendenciaEstornoGateway } from './prisma-pendencia-estorno.gateway';

const raw = {
  id: 'p1',
  cobrancaId: 'c1',
  ordemServicoId: 'os1',
  rodada: 1,
  valorCobrancaCentavos: 5000,
  situacao: 'ABERTA' as const,
  motivoAbertura: 'teste',
  responsavelId: null,
  decisao: null,
  valorEstornadoCentavos: null,
  justificativa: null,
  resolvidaEm: null,
};

describe('PrismaPendenciaEstornoGateway', () => {
  it('cria pendência ABERTA', async () => {
    const create = jest.fn().mockResolvedValue(raw);
    const gateway = new PrismaPendenciaEstornoGateway({
      pendenciaEstorno: {},
    } as never);
    const ctx = new PrismaContextoTransacao({
      pendenciaEstorno: { create },
    } as never);
    const reg = await gateway.criar(ctx, {
      cobrancaId: 'c1',
      ordemServicoId: 'os1',
      rodada: 1,
      valorCobrancaCentavos: 5000,
      motivoAbertura: 'teste',
    });
    expect(reg.id).toBe('p1');
  });

  it('buscarPorId e listarAbertas', async () => {
    const prisma = {
      pendenciaEstorno: {
        findUnique: jest.fn().mockResolvedValue(raw),
        findMany: jest.fn().mockResolvedValue([raw]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const gateway = new PrismaPendenciaEstornoGateway(prisma as never);
    await expect(gateway.buscarPorId('p1')).resolves.toEqual(
      expect.objectContaining({ situacao: 'ABERTA' }),
    );
    const lista = await gateway.listarAbertas(1, 10);
    expect(lista.total).toBe(1);
    expect(lista.itens).toHaveLength(1);
  });

  it('resolver marca RESOLVIDA', async () => {
    const update = jest.fn().mockResolvedValue({
      ...raw,
      situacao: 'RESOLVIDA',
      decisao: 'SEM_ESTORNO',
    });
    const gateway = new PrismaPendenciaEstornoGateway({
      pendenciaEstorno: {},
    } as never);
    const ctx = new PrismaContextoTransacao({
      pendenciaEstorno: { update },
    } as never);
    const reg = await gateway.resolver(ctx, 'p1', {
      responsavelId: 'admin',
      decisao: 'SEM_ESTORNO',
    });
    expect(reg.situacao).toBe('RESOLVIDA');
  });

  describe('buscarAbertaPorCobrancaId', () => {
    it('devolve a pendência aberta mais antiga da cobrança', async () => {
      const findFirst = jest.fn().mockResolvedValue(raw);
      const gateway = new PrismaPendenciaEstornoGateway({
        pendenciaEstorno: { findFirst },
      } as never);

      await expect(
        gateway.buscarAbertaPorCobrancaId('c1'),
      ).resolves.toMatchObject({ id: 'p1' });
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          cobrancaId: 'c1',
          situacao: 'ABERTA',
          estornosAutomaticos: { none: {} },
        },
        orderBy: { criadoEm: 'asc' },
      });
    });

    it('devolve null quando não há pendência aberta', async () => {
      const gateway = new PrismaPendenciaEstornoGateway({
        pendenciaEstorno: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never);

      await expect(gateway.buscarAbertaPorCobrancaId('c1')).resolves.toBeNull();
    });
  });
});
