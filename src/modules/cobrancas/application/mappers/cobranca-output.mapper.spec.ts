import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import { CobrancaOutputMapper } from './cobranca-output.mapper';

describe('CobrancaOutputMapper', () => {
  it('mapeia cobrança para saída da API', () => {
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2026-11-15T12:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'https://checkout',
    });

    const output = CobrancaOutputMapper.toOutput(cobranca);
    expect(output.situacao).toBe('PENDENTE');
    expect(output.linkPagamento).toBe('https://checkout');
  });
});