import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import { PrismaCobrancaGateway } from './prisma-cobranca.gateway';
import { PrismaCobrancaMapper } from './prisma-cobranca.mapper';

describe('PrismaCobrancaGateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cria cobrança usando cliente da transação', async () => {
    const criado = { id: 'c1' };
    const clienteTx = {
      cobranca: { create: jest.fn().mockResolvedValue(criado) },
    };
    const prisma = {
      cobranca: {
        create: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        $transaction: jest.fn(),
      },
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    const cobranca = Cobranca.criarIntencaoAPartirDoOrcamento({
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cli',
      correlationId: 'corr',
      valorTotalCentavos: 100,
      prazoPagamento: new Date(),
    });

    jest.spyOn(PrismaCobrancaMapper, 'toPersistence');
    jest.spyOn(PrismaCobrancaMapper, 'toDomain').mockReturnValue(cobranca);

    await gateway.criar(contexto, cobranca);
    expect(clienteTx.cobranca.create).toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
  });

  it('busca cobrança por orçamento', async () => {
    const prisma = {
      cobranca: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    await expect(gateway.buscarPorOrcamentoId('o1')).resolves.toBeNull();
  });

  it('busca cobrança por ordem de serviço e rodada', async () => {
    const row = {
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 2,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date(),
      situacao: SituacaoCobranca.PENDENTE,
    };
    const prisma = {
      cobranca: {
        findFirst: jest.fn().mockResolvedValue(row),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    jest.spyOn(PrismaCobrancaMapper, 'toDomain').mockReturnValue(
      new Cobranca({
        ...row,
        prazoPagamento: row.prazoPagamento,
      }),
    );
    const encontrada = await gateway.buscarPorOrdemServicoERodada('os1', 2);
    expect(encontrada?.rodada).toBe(2);
    expect(prisma.cobranca.findFirst).toHaveBeenCalled();
  });

  it('retorna nulo quando não há cobrança para OS e rodada', async () => {
    const prisma = {
      cobranca: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    await expect(
      gateway.buscarPorOrdemServicoERodada('os1', 1),
    ).resolves.toBeNull();
  });

  it('lista cobranças com filtro', async () => {
    const row = {
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date(),
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: null,
      pagamentoConfirmadoEm: null,
      bloqueadoConciliacaoAte: null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    };
    const prisma = {
      cobranca: {
        findUnique: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([row]),
      },
      $transaction: jest.fn((promises) => Promise.all(promises)),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    const resultado = await gateway.listar(1, 10, {
      ordemServicoId: 'os1',
      clienteId: 'cl',
    });
    expect(resultado.total).toBe(1);
    expect(resultado.itens[0]?.id).toBe('c1');
  });

  it('atualiza cobrança na transação', async () => {
    const cobranca = Cobranca.criarIntencaoAPartirDoOrcamento({
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date(),
    });
    const clienteTx = {
      cobranca: { update: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const prisma = {
      cobranca: { update: jest.fn() },
      $transaction: jest.fn(),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    jest.spyOn(PrismaCobrancaMapper, 'toDomain').mockReturnValue(cobranca);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    await gateway.atualizar(contexto, 'c1', cobranca);
    expect(clienteTx.cobranca.update).toHaveBeenCalled();
  });

  it('busca cobrança por id', async () => {
    const prisma = {
      cobranca: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    await expect(gateway.buscarPorId('c1')).resolves.toBeNull();
  });

  it('reivindica cobranças pendentes para conciliação', async () => {
    const row = {
      id: 'c2',
      orcamentoId: 'o2',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date(),
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'url',
      pagamentoConfirmadoEm: null,
      bloqueadoConciliacaoAte: null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    };
    const prisma = {
      cobranca: { updateMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (fn) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'c2' }]),
          cobranca: {
            updateMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([row]),
          },
        }),
      ),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    const pendentes = await gateway.reivindicarPendentesConciliacao(5, 1000);
    expect(pendentes[0]?.situacao).toBe(SituacaoCobranca.PENDENTE);
  });

  it('reivindica cobranças pendentes com prazo vencido', async () => {
    const row = {
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date('2020-01-01'),
      situacao: SituacaoCobranca.PENDENTE,
    };
    const prisma = {
      cobranca: { updateMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (fn) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'c1' }]),
          cobranca: {
            updateMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([row]),
          },
        }),
      ),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    jest.spyOn(PrismaCobrancaMapper, 'toDomain').mockReturnValue(
      new Cobranca({
        ...row,
        prazoPagamento: row.prazoPagamento,
      }),
    );
    const pendentes = await gateway.reivindicarPendentesExpiracao(5, 1000);
    expect(pendentes[0]?.situacao).toBe(SituacaoCobranca.PENDENTE);
  });

  it('expiração reivindicada retorna vazio sem candidatas', async () => {
    const prisma = {
      cobranca: { updateMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (fn) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          cobranca: { updateMany: jest.fn(), findMany: jest.fn() },
        }),
      ),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    await expect(
      gateway.reivindicarPendentesExpiracao(5, 1000),
    ).resolves.toEqual([]);
  });

  it('retorna vazio quando nenhuma cobrança reivindicada', async () => {
    const prisma = {
      cobranca: { updateMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (fn) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          cobranca: { updateMany: jest.fn(), findMany: jest.fn() },
        }),
      ),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    await expect(
      gateway.reivindicarIntencoesCriacaoOrder(5, 1000),
    ).resolves.toEqual([]);
  });

  it('reivindica cobranças em intenção', async () => {
    const row = {
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date(),
      situacao: SituacaoCobranca.INTENCAO,
      linkPagamento: null,
      pagamentoConfirmadoEm: null,
      bloqueadoConciliacaoAte: null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    };
    const prisma = {
      cobranca: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([row]),
      },
      $transaction: jest.fn(async (fn) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'c1' }]),
          cobranca: {
            updateMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([row]),
          },
        }),
      ),
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    const reivindicadas = await gateway.reivindicarIntencoesCriacaoOrder(
      5,
      1000,
    );
    expect(reivindicadas[0]?.id).toBe('c1');
  });

  it('atualizarSePosse aplica fence em bloqueado_conciliacao_ate', async () => {
    const posse = new Date('2099-01-01T00:00:00.000Z');
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date('2099-12-31'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const clienteTx = { cobranca: { updateMany } };
    const prisma = {
      cobranca: { updateMany, update: jest.fn() },
      orderMercadoPago: { findUnique: jest.fn() },
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(clienteTx as never);
    await expect(
      gateway.atualizarSePosse(contexto, 'c1', cobranca, posse),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', bloqueadoConciliacaoAte: posse },
      }),
    );
  });

  it('busca cobrança por order do Mercado Pago', async () => {
    const cobranca = Cobranca.criarIntencaoAPartirDoOrcamento({
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 10,
      prazoPagamento: new Date(),
    });
    const prisma = {
      orderMercadoPago: {
        findUnique: jest.fn().mockResolvedValue({ cobranca: { id: 'c1' } }),
      },
      cobranca: {},
      $transaction: jest.fn(),
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    jest.spyOn(PrismaCobrancaMapper, 'toDomain').mockReturnValue(cobranca);
    const encontrada = await gateway.buscarPorMercadoPagoOrderId('ORD1');
    expect(encontrada).toBe(cobranca);
  });
});
