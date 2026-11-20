import {
  DomainConflictError,
  DomainNotFoundError,
} from '@/shared/exceptions/domain.error';
import type { SituacaoCobranca } from '../situacao-cobranca';

export class CobrancaNaoEncontradaError extends DomainNotFoundError {
  constructor(identificador: string) {
    super(`Cobrança não encontrada: ${identificador}.`);
  }
}

export class SituacaoCobrancaInvalidaError extends DomainConflictError {
  constructor(atual: SituacaoCobranca, operacao: string) {
    super(
      `Cobrança em situação "${atual}" não permite a operação "${operacao}".`,
    );
  }
}
