import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaOperacaoFinanceiraGateway } from './prisma-operacao-financeira.gateway';

const rawBase = {
  id: 'op1',
  eventId: 'ev1',
  ordemServicoId: 'os1',
  rodada: 1,
  correlationId: 'corr',
  tipo: 'CANCELAMENTO_FINANCEIRO' as const,
  situacao: 'EM_ANDAMENTO' as const,
  chaveIdempotenciaMercadoPago: 'chave',
  resultadoExecucao: 'REPARO_NAO_INICIADO' as const,
  motivoCancelamento: null,
  etapaOrigem: null,
  cobrancaId: null,
  resultado: null,
  pendenciaId: null,
  bloqueadoProcessamentoAte: null,
  tentativasMercadoPago: 0,
};

describe('PrismaOperacaoFinanceiraGateway', () => {
  it('cria operação EM_ANDAMENTO com chave MP', async () => {
    const create = jest.fn().mockResolvedValue(rawBase);
    const clienteTx = { operacaoFinanceira: { create, findUnique: jest.fn() } };
    const prisma = { operacaoFinanceira: clienteTx.operacaoFinanceira };
    const gateway = new PrismaOperacaoFinanceiraGateway(prisma as never);
    const ctx = new PrismaContextoTransacao(clienteTx as never);
    const registro = await gateway.criar(ctx, {
      eventId: 'ev1',
      ordemServicoId: 'os1',
      rodada: 1,
      correlationId: 'corr',
      chaveIdempotenciaMercadoPago: 'chave',
      resultadoExecucao: 'REPARO_NAO_INICIADO',
    });
    expect(registro.chaveIdempotenciaMercadoPago).toBe('chave');
    expect(create).toHaveBeenCalled();
  });

  it('buscarPorId retorna null quando inexistente', async () => {
    const prisma = {
      operacaoFinanceira: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const gateway = new PrismaOperacaoFinanceiraGateway(prisma as never);
    await expect(gateway.buscarPorId('x')).resolves.toBeNull();
  });

  it('buscarPorId mapeia registro', async () => {
    const prisma = {
      operacaoFinanceira: {
        findUnique: jest.fn().mockResolvedValue(rawBase),
      },
    };
    const gateway = new PrismaOperacaoFinanceiraGateway(prisma as never);
    const reg = await gateway.buscarPorId('op1');
    expect(reg?.eventId).toBe('ev1');
  });

  it('buscarPorEventId na transação', async () => {
    const findUnique = jest.fn().mockResolvedValue(rawBase);
    const clienteTx = { operacaoFinanceira: { findUnique } };
    const gateway = new PrismaOperacaoFinanceiraGateway({
      operacaoFinanceira: {},
    } as never);
    const ctx = new PrismaContextoTransacao(clienteTx as never);
    const reg = await gateway.buscarPorEventId(ctx, 'ev1');
    expect(reg?.id).toBe('op1');
    expect(findUnique).toHaveBeenCalled();
  });

  it('concluir atualiza situação e resultado', async () => {
    const update = jest.fn();
    const clienteTx = { operacaoFinanceira: { update } };
    const gateway = new PrismaOperacaoFinanceiraGateway({
      operacaoFinanceira: {},
    } as never);
    const ctx = new PrismaContextoTransacao(clienteTx as never);
    await gateway.concluir(ctx, 'op1', {
      cobrancaId: 'c1',
      resultado: 'CANCELADA',
      pendenciaId: null,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'op1' },
        data: expect.objectContaining({ situacao: 'CONCLUIDA' }),
      }),
    );
  });

  it('adiarProcessamento e incrementar tentativas', async () => {
    const update = jest.fn();
    const prisma = { operacaoFinanceira: { update } };
    const gateway = new PrismaOperacaoFinanceiraGateway(prisma as never);
    const ate = new Date();
    await gateway.adiarProcessamento('op1', ate);
    await gateway.incrementarTentativasMercadoPago('op1');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('reivindicarEmAndamento sem pendentes retorna vazio', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          operacaoFinanceira: { updateMany: jest.fn(), findMany: jest.fn() },
        }),
      ),
    };
    const gateway = new PrismaOperacaoFinanceiraGateway(prisma as never);
    const regs = await gateway.reivindicarEmAndamento(5, 10_000);
    expect(regs).toEqual([]);
  });

  it('criarConsulta grava consultaId e finalidade', async () => {
    const create = jest.fn().mockResolvedValue({
      ...rawBase,
      tipo: 'CONSULTA_SITUACAO_FINANCEIRA',
      consultaId: 'consulta-1',
      finalidadeConsulta: 'EXCECAO_E10',
      resultadoExecucao: null,
    });
    const clienteTx = { operacaoFinanceira: { create, findUnique: jest.fn() } };
    const prisma = { operacaoFinanceira: clienteTx.operacaoFinanceira };
    const gateway = new PrismaOperacaoFinanceiraGateway(prisma as never);
    const ctx = new PrismaContextoTransacao(clienteTx as never);
    const registro = await gateway.criarConsulta(ctx, {
      eventId: 'ev2',
      ordemServicoId: 'os1',
      rodada: 1,
      correlationId: 'corr',
      consultaId: 'consulta-1',
      finalidade: 'EXCECAO_E10',
    });
    expect(registro.consultaId).toBe('consulta-1');
    expect(create).toHaveBeenCalled();
  });

  it('reivindicarEmAndamento bloqueia e retorna operações', async () => {
    const findMany = jest.fn().mockResolvedValue([rawBase]);
    const updateMany = jest.fn();
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'op1' }]),
          operacaoFinanceira: { updateMany, findMany },
        }),
      ),
    };
    const gateway = new PrismaOperacaoFinanceiraGateway(prisma as never);
    const regs = await gateway.reivindicarEmAndamento(1, 5_000);
    expect(regs).toHaveLength(1);
    expect(updateMany).toHaveBeenCalled();
  });
});
