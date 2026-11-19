import {
  DomainConflictError,
  DomainNotFoundError,
} from '@/shared/exceptions/domain.error';

export class PendenciaEstornoNaoEncontradaError extends DomainNotFoundError {
  constructor(id: string) {
    super(`Pendência de estorno não encontrada: ${id}.`);
  }
}

export class PendenciaEstornoSemPagamentoError extends DomainConflictError {
  constructor(id: string) {
    super(
      `A cobrança da pendência ${id} não tem pagamento confirmado: só a decisão SEM_ESTORNO é permitida.`,
    );
  }
}

export class PendenciaEstornoJaResolvidaError extends DomainConflictError {
  constructor(id: string) {
    super(`Pendência de estorno já resolvida: ${id}.`);
  }
}
