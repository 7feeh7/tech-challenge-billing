import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaOrcamentoGateway } from './prisma-orcamento.gateway';
import { criarOrcamentoFake } from '../../application/use-cases/test-doubles';

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