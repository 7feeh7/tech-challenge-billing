import type { ContextoTransacao, UnitOfWork } from './unit-of-work.port';

const contextoFalso: ContextoTransacao = {
  _contextoTransacao: 'transacao',
};

export class UnitOfWorkFake implements UnitOfWork {
  async executar<T>(
    trabalho: (contexto: ContextoTransacao) => Promise<T>,
  ): Promise<T> {
    return trabalho(contextoFalso);
  }
}