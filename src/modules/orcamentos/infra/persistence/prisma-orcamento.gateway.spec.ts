import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { criarOrcamentoFake } from '../../application/use-cases/test-doubles';
import { PrismaOrcamentoGateway } from './prisma-orcamento.gateway';

describe('PrismaOrcamentoGateway', () => {
  const clienteTx = {
    orcamento: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    orcamento: {
      ...clienteTx.orcamento,
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const gateway = new PrismaOrcamentoGateway(prisma as never);
  const contexto = new PrismaContextoTransacao(clienteTx as never);

  beforeEach(() => jest.clearAllMocks());

  it('busca por id', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null);
    await expect(gateway.buscarPorId('x')).resolves.toBeNull();
  });

  it('lista com paginação', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);
    const resultado = await gateway.listar(1, 10, {});
    expect(resultado.total).toBe(0);
  });

  it('lista com filtros de OS e cliente', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);
    await gateway.listar(2, 5, {
      ordemServicoId: 'os-1',
      clienteId: 'cli-1',
    });
    expect(prisma.orcamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ordemServicoId: 'os-1', clienteId: 'cli-1' },
      }),
    );
  });

  it('busca por OS e rodada na transação', async () => {
    clienteTx.orcamento.findUnique.mockResolvedValue(null);
    await gateway.buscarPorOrdemServicoERodada(contexto, 'os', 1);
    expect(clienteTx.orcamento.findUnique).toHaveBeenCalled();
  });

  it('atualiza orçamento na transação', async () => {
    const fake = criarOrcamentoFake();
    fake.rejeitar('motivo');
    clienteTx.orcamento.update.mockResolvedValue({
      id: fake.id,
      ordemServicoId: fake.ordemServicoId,
      rodada: fake.rodada,
      clienteId: fake.clienteId,
      correlationId: fake.correlationId,
      valorTotalCentavos: fake.valorTotalCentavos,
      situacao: fake.situacao,
      motivoRejeicao: fake.motivoRejeicao,
      tentativaAprovacao: 0,
      rejeitadoEm: new Date(),
      criadoEm: new Date(),
      atualizadoEm: new Date(),
      itens: [],
    });
    await gateway.atualizar(contexto, fake.id as string, fake);
    expect(clienteTx.orcamento.update).toHaveBeenCalled();
  });

  it('cria orçamento na transação', async () => {
    const fake = criarOrcamentoFake();
    clienteTx.orcamento.create.mockResolvedValue({
      ...fake,
      itens: [],
      situacao: fake.situacao,
      valorTotalCentavos: fake.valorTotalCentavos,
      motivoRejeicao: null,
      tentativaAprovacao: 0,
      rejeitadoEm: null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
      correlationId: fake.correlationId,
    });

    await gateway.criar(contexto, fake);
    expect(clienteTx.orcamento.create).toHaveBeenCalled();
  });
});
