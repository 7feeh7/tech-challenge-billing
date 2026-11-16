import { SituacaoOrcamento } from '../../domain/situacao-orcamento';
import { PrismaOrcamentoMapper } from './prisma-orcamento.mapper';
import { criarOrcamentoFake } from '../../application/use-cases/test-doubles';

describe('PrismaOrcamentoMapper', () => {
  it('converte linha do banco para domínio', () => {
    const raw = {
      id: 'id',
      ordemServicoId: 'os',
      rodada: 1,
      clienteId: 'c',
      correlationId: 'corr',
      valorTotalCentavos: 100,
      situacao: SituacaoOrcamento.GERADO,
      motivoRejeicao: null,
      tentativaAprovacao: 0,
      rejeitadoEm: null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
      itens: [
        {
          id: 'i',
          orcamentoId: 'id',
          tipo: 'SERVICO',
          itemId: 'item',
          nome: 'Nome',
          quantidade: 1,
          precoUnitarioCentavos: 100,
        },
      ],
    };

    const dominio = PrismaOrcamentoMapper.toDomain(raw);
    expect(dominio.valorTotalCentavos).toBe(100);
  });

  it('mapeia entidade para persistência', () => {
    const fake = criarOrcamentoFake();
    const data = PrismaOrcamentoMapper.toPersistence(fake);
    expect(data.itens.create).toHaveLength(1);
  });
});