import {
  DomainConflictError,
  DomainNotFoundError,
  DomainValidationError,
} from '@/shared/exceptions/domain.error';

export class OrcamentoNaoEncontradoError extends DomainNotFoundError {
  constructor(id: string) {
    super(`Orçamento com id "${id}" não encontrado.`);
  }
}

export class MotivoRejeicaoObrigatorioError extends DomainValidationError {
  constructor() {
    super('O motivo da rejeição é obrigatório.');
  }
}

export class SituacaoOrcamentoInvalidaError extends DomainConflictError {
  constructor(situacaoAtual: string, operacao: string) {
    super(
      `Não é possível ${operacao} com o orçamento na situação ${situacaoAtual}.`,
    );
  }
}

export class ItensOrcamentoInvalidosError extends DomainValidationError {
  constructor(mensagem = 'A lista de itens do orçamento é inválida.') {
    super(mensagem);
  }
}

export class ConteudoMensagemDivergenteError extends DomainConflictError {
  constructor(eventId: string) {
    super(
      `Mensagem com eventId ${eventId} já processada com conteúdo divergente.`,
    );
  }
}
