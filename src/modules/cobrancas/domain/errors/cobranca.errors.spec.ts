import { SituacaoCobranca } from '../situacao-cobranca';
import {
  CobrancaNaoEncontradaError,
  SituacaoCobrancaInvalidaError,
} from './cobranca.errors';

describe('cobranca.errors', () => {
  it('expõe mensagens de domínio', () => {
    expect(new CobrancaNaoEncontradaError('x').message).toContain('x');
    expect(
      new SituacaoCobrancaInvalidaError(SituacaoCobranca.PAGA, 'op').message,
    ).toContain('PAGA');
  });
});
