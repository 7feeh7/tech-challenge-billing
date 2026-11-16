export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface ContextoTransacao {
  readonly _contextoTransacao: 'transacao';
}

export interface UnitOfWork {
  executar<T>(
    trabalho: (contexto: ContextoTransacao) => Promise<T>,
  ): Promise<T>;
}