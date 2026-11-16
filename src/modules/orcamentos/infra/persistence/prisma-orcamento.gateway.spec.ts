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

  it('reivindica aprovações pendentes com transação', async () => {
    prisma.$transaction.mockImplementation(
      async (trabalho: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'orc-1' }]),
          orcamento: {
            updateMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'orc-1',
                ordemServicoId: 'os',
                rodada: 1,
                clienteId: 'c',
                correlationId: 'corr',
                valorTotalCentavos: 10,
                situacao: 'APROVACAO_EM_ANDAMENTO',
                motivoRejeicao: null,
                tentativaAprovacao: 1,
                prazoReferencia: null,
                reservaId: null,
                aprovadoEm: null,
                bloqueadoAprovacaoAte: null,
                rejeitadoEm: null,
                criadoEm: new Date(),
                atualizadoEm: new Date(),
                itens: [],
              },
            ]),
          },
        };
        return trabalho(tx);
      },
    );

    const itens = await gateway.reivindicarAprovacoesPendentes(1000);
    expect(itens).toHaveLength(1);
  });

  it('inicia aprovação somente em GERADO', async () => {
    clienteTx.orcamento.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await expect(
      gateway.iniciarAprovacaoSeGerado(contexto, 'id'),
    ).resolves.toBeNull();
  });

  it('inicia aprovação quando GERADO e retorna domínio', async () => {
    const fake = criarOrcamentoFake();
    clienteTx.orcamento.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    clienteTx.orcamento.findUnique = jest.fn().mockResolvedValue({
      id: fake.id,
      ordemServicoId: fake.ordemServicoId,
      rodada: fake.rodada,
      clienteId: fake.clienteId,
      correlationId: fake.correlationId,
      valorTotalCentavos: fake.valorTotalCentavos,
      situacao: 'APROVACAO_EM_ANDAMENTO',
      motivoRejeicao: null,
      tentativaAprovacao: 1,
      bloqueadoAprovacaoAte: null,
      rejeitadoEm: null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
      itens: [],
    });
    const resultado = await gateway.iniciarAprovacaoSeGerado(
      contexto,
      fake.id as string,
    );
    expect(resultado?.situacao).toBe('APROVACAO_EM_ANDAMENTO');
  });

  it('adia bloqueio de aprovação', async () => {
    prisma.orcamento.update = jest.fn();
    await gateway.adiarBloqueioAprovacao('orc-1', 5000);
    expect(prisma.orcamento.update).toHaveBeenCalled();
  });

  it('libera bloqueio de aprovação', async () => {
    prisma.orcamento.update = jest.fn();
    await gateway.liberarBloqueioAprovacao('orc-1');
    expect(prisma.orcamento.update).toHaveBeenCalled();
  });
});
