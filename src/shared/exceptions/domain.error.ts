/**
 * Base das exceções de domínio. O domínio lança estes erros sem conhecer HTTP;
 * o DomainExceptionFilter traduz cada categoria para o status correspondente.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invariante de domínio violada. */
export abstract class DomainValidationError extends DomainError {}

/** Recurso inexistente. */
export abstract class DomainNotFoundError extends DomainError {}

/** Conflito com o estado atual. */
export abstract class DomainConflictError extends DomainError {}

/** Conflito de negócio com código estável para a API. */
export class DomainConflictComCodigoError extends DomainConflictError {
  constructor(
    readonly codigo: string,
    message: string,
  ) {
    super(message);
  }
}

/** Credenciais ausentes ou inválidas. */
export abstract class DomainUnauthorizedError extends DomainError {}
