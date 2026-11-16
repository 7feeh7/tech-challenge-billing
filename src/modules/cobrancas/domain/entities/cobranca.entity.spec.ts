import { SituacaoCobrancaInvalidaError } from '../errors/cobranca.errors';
import { SituacaoCobranca } from '../situacao-cobranca';
import { Cobranca } from './cobranca.entity';

describe('Cobranca', () => {
  const base = {
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'c1',
    correlationId: 'corr',
    valorTotalCentavos: 5000,
    prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
  };

  it('cria intenção a partir do orçamento', () => {
    const cobranca = Cobranca.criarIntencaoAPartirDoOrcamento(base);
    expect(cobranca.situacao).toBe(SituacaoCobranca.INTENCAO);
  });

  it('marca pendente com link', () => {
    const cobranca = new Cobranca(base);
    cobranca.marcarPendente('https://checkout');
    expect(cobranca.situacao).toBe(SituacaoCobranca.PENDENTE);
    expect(cobranca.linkPagamento).toBe('https://checkout');
  });

  it('confirma pagamento idempotente quando já paga', () => {
    const cobranca = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    expect(() =>
      cobranca.confirmarPagamento(new Date('2026-01-01T00:00:00.000Z')),
    ).not.toThrow();
  });

  it('avalia prazo de pagamento', () => {
    const cobranca = new Cobranca({
      ...base,
      prazoPagamento: new Date('2000-01-01T00:00:00.000Z'),
    });
    expect(cobranca.aindaNoPrazo(new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('rejeita confirmar pagamento fora de PENDENTE', () => {
    const cobranca = new Cobranca(base);
    expect(() => cobranca.confirmarPagamento(new Date())).toThrow(
      SituacaoCobrancaInvalidaError,
    );
  });
});