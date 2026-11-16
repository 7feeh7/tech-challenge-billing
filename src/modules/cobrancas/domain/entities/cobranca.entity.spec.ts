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

  it('atualiza link quando cobrança já está pendente', () => {
    const cobranca = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PENDENTE,
      linkPagamento: 'https://antigo',
    });
    cobranca.marcarPendente('https://novo');
    expect(cobranca.linkPagamento).toBe('https://novo');
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
    expect(cobranca.aindaNoPrazo(new Date('2026-01-01T00:00:00.000Z'))).toBe(
      false,
    );
  });

  it('rejeita confirmar pagamento fora de PENDENTE', () => {
    const cobranca = new Cobranca(base);
    expect(() => cobranca.confirmarPagamento(new Date())).toThrow(
      SituacaoCobrancaInvalidaError,
    );
  });

  it('transiciona cancelamento e estorno', () => {
    const pendente = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PENDENTE,
    });
    pendente.marcarCancelada();
    expect(pendente.situacao).toBe(SituacaoCobranca.CANCELADA);

    const paga = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    paga.iniciarEstorno();
    expect(paga.situacao).toBe(SituacaoCobranca.ESTORNO_EM_ANDAMENTO);
    paga.marcarEstornada();
    expect(paga.situacao).toBe(SituacaoCobranca.ESTORNADA);

    const paga2 = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    paga2.marcarPendenciaManual();
    expect(paga2.situacao).toBe(SituacaoCobranca.PENDENCIA_MANUAL);
  });

  it('rejeita transições inválidas de situação', () => {
    const intencao = new Cobranca(base);
    expect(() => intencao.marcarExpirada()).toThrow(
      SituacaoCobrancaInvalidaError,
    );

    const paga = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    paga.marcarEstornada();
    expect(() => paga.iniciarEstorno()).toThrow(SituacaoCobrancaInvalidaError);

    const cancelada = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.CANCELADA,
    });
    cancelada.marcarCancelada();

    const pendente = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PENDENTE,
    });
    pendente.marcarCancelada();
    pendente.marcarCancelada();

    const estorno = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
    });
    estorno.marcarEstornada();
    estorno.marcarEstornada();

    const pendencia = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PENDENCIA_MANUAL,
    });
    pendencia.marcarPendenciaManual();
  });

  it('bloqueia e libera conciliação', () => {
    const cobranca = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PENDENTE,
    });
    const ate = new Date('2099-06-01T00:00:00.000Z');
    cobranca.bloquearConciliacao(ate);
    expect(cobranca.bloqueadoConciliacaoAte).toEqual(ate);
    cobranca.liberarBloqueioConciliacao();
    expect(cobranca.bloqueadoConciliacaoAte).toBeNull();
  });

  it('expira cobrança pendente e detecta prazo vencido', () => {
    const pendente = new Cobranca({
      ...base,
      situacao: SituacaoCobranca.PENDENTE,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect(pendente.prazoVencido(new Date('2021-01-01T00:00:00.000Z'))).toBe(
      true,
    );
    pendente.marcarExpirada();
    expect(pendente.situacao).toBe(SituacaoCobranca.EXPIRADA);
    expect(pendente.linkPagamento).toBeNull();
    pendente.marcarExpirada();
  });
});
