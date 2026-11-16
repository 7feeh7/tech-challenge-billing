import { SituacaoCobranca } from '../situacao-cobranca';
import { Cobranca } from './cobranca.entity';

describe('Cobranca', () => {
  it('cria intenção a partir do orçamento', () => {
    const prazo = new Date('2026-11-15T12:00:00.000Z');
    const cobranca = Cobranca.criarIntencaoAPartirDoOrcamento({
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'c1',
      correlationId: 'corr',
      valorTotalCentavos: 5000,
      prazoPagamento: prazo,
    });
    expect(cobranca.situacao).toBe(SituacaoCobranca.INTENCAO);
    expect(cobranca.prazoPagamento).toBe(prazo);
  });
});
