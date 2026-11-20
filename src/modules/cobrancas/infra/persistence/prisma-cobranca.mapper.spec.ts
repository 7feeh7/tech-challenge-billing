import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import { PrismaCobrancaMapper } from './prisma-cobranca.mapper';

describe('PrismaCobrancaMapper', () => {
  it('converte persistência e domínio', () => {
    const prazo = new Date();
    const cobranca = Cobranca.criarIntencaoAPartirDoOrcamento({
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'c1',
      correlationId: 'corr',
      valorTotalCentavos: 100,
      prazoPagamento: prazo,
    });
    const persistencia = PrismaCobrancaMapper.toPersistence(cobranca);
    const dominio = PrismaCobrancaMapper.toDomain({
      id: 'id-1',
      ...persistencia,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    } as never);
    expect(dominio.valorTotalCentavos).toBe(100);
  });

  it('mapeia atualização com link e confirmação', () => {
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 100,
      prazoPagamento: new Date(),
      situacao: SituacaoCobranca.PAGA,
      linkPagamento: 'url',
      pagamentoConfirmadoEm: new Date(),
    });
    const update = PrismaCobrancaMapper.toUpdate(cobranca);
    expect(update.situacao).toBe(SituacaoCobranca.PAGA);
    expect(update.linkPagamento).toBe('url');
  });
});
