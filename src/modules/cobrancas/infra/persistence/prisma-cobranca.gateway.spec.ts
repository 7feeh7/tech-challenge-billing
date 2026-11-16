import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { PrismaCobrancaGateway } from './prisma-cobranca.gateway';
import { PrismaCobrancaMapper } from './prisma-cobranca.mapper';

describe('PrismaCobrancaGateway', () => {
  it('cria cobrança usando cliente da transação', async () => {
    const criado = { id: 'c1' };
    const clienteTx = {
      cobranca: { create: jest.fn().mockResolvedValue(criado) },
    };
    const prisma = { cobranca: { create: jest.fn(), findUnique: jest.fn() } };
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
    };
    const gateway = new PrismaCobrancaGateway(prisma as never);
    await expect(gateway.buscarPorOrcamentoId('o1')).resolves.toBeNull();
  });
});
