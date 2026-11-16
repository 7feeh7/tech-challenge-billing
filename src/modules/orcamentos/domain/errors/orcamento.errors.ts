import {
  DomainConflictComCodigoError,
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

export class EstoqueInsuficienteAprovacaoError extends DomainConflictComCodigoError {
  constructor() {
    super(
      'ESTOQUE_INSUFICIENTE',
      'Estoque insuficiente para aprovar o orçamento.',
    );
  }
}

export class EstadoIncompativelAprovacaoError extends DomainConflictComCodigoError {
  constructor() {
    super(
      'ESTADO_INCOMPATIVEL',
      'Orçamento em processamento, tente novamente.',
    );
  }
}

export class AprovacaoEncerradaError extends DomainConflictComCodigoError {
  constructor(codigo: 'OS_EM_CANCELAMENTO' | 'RODADA_OBSOLETA') {
    const mensagens = {
      OS_EM_CANCELAMENTO:
        'A ordem de serviço está em cancelamento; a aprovação foi encerrada.',
      RODADA_OBSOLETA:
        'A rodada do orçamento não é mais vigente; a aprovação foi encerrada.',
    };
    super(codigo, mensagens[codigo]);
  }
}
