import {
  DomainConflictError,
  DomainNotFoundError,
} from '@/shared/exceptions/domain.error';

export class PendenciaEstornoNaoEncontradaError extends DomainNotFoundError {
  constructor(id: string) {
    super(`Pendência de estorno não encontrada: ${id}.`);
  }
}

export class PendenciaEstornoJaResolvidaError extends DomainConflictError {
  constructor(id: string) {
    super(`Pendência de estorno já resolvida: ${id}.`);
  }
}
