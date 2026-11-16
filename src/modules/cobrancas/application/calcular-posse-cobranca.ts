import { ConfiguracaoReivindicacaoInvalidaError } from '@/shared/config/configuracao-reivindicacao-invalida.error';

export const APROVACAO_LOTE_PADRAO = 10;
export const OUTBOX_LOTE_PADRAO = 10;
const MARGEM_GRAVACAO_MS = 5_000;

/** Consulta (`responderComEfeito`): até consulta + consulta + cancel + consulta num único `executar`. */
export const CHAMADAS_MP_CONSULTA_FINANCEIRA_POR_EXECUCAO = 4;
/** Cancelamento/estorno num único `executar`: post (cancel/refund) + GET de confirmação (+ GET em 409 verificável). */
export const CHAMADAS_MP_CANCELAMENTO_FINANCEIRO_POR_EXECUCAO = 3;

export function calcularPosseProcessadorMs(params: {
  lote: number;
  chamadasMercadoPagoPorItem: number;
  mpRequestTimeoutMs: number;
  margemGravacaoMs?: number;
}): number {
  const margem = params.margemGravacaoMs ?? MARGEM_GRAVACAO_MS;
  return (
    params.lote *
    (params.chamadasMercadoPagoPorItem * params.mpRequestTimeoutMs + margem)
  );
}

export function calcularMinimoPosseAprovacaoMs(params: {
  lote: number;
  osRequestMaxTentativas: number;
  osRequestTimeoutMs: number;
  margemGravacaoMs?: number;
}): number {
  const margem = params.margemGravacaoMs ?? MARGEM_GRAVACAO_MS;
  return (
    params.lote *
    (params.osRequestMaxTentativas * params.osRequestTimeoutMs + margem)
  );
}

export function calcularMinimoPosseOutboxMs(params: {
  lote: number;
  sqsRequestTimeoutMs: number;
  margemGravacaoMs?: number;
}): number {
  const margem = params.margemGravacaoMs ?? MARGEM_GRAVACAO_MS;
  return params.lote * (params.sqsRequestTimeoutMs + margem);
}

export function calcularMinimoPosseCobrancaMs(params: {
  loteConciliacao: number;
  loteCriacao: number;
  loteExpiracao: number;
  mpRequestTimeoutMs: number;
}): number {
  const posseConciliacao = calcularPosseProcessadorMs({
    lote: params.loteConciliacao,
    chamadasMercadoPagoPorItem: 3,
    mpRequestTimeoutMs: params.mpRequestTimeoutMs,
  });
  const posseCriacao = calcularPosseProcessadorMs({
    lote: params.loteCriacao,
    chamadasMercadoPagoPorItem: 1,
    mpRequestTimeoutMs: params.mpRequestTimeoutMs,
  });
  const posseExpiracao = calcularPosseProcessadorMs({
    lote: params.loteExpiracao,
    chamadasMercadoPagoPorItem: 3,
    mpRequestTimeoutMs: params.mpRequestTimeoutMs,
  });
  return Math.max(posseConciliacao, posseCriacao, posseExpiracao);
}

/** Posse mínima para processadores de cobrança (criação, conciliação e expiração). */
export function calcularPosseCobrancaMs(params: {
  loteConciliacao: number;
  loteCriacao: number;
  loteExpiracao?: number;
  mpRequestTimeoutMs: number;
  overrideMs?: number;
  validarOverride?: boolean;
}): number {
  const loteExpiracao = params.loteExpiracao ?? params.loteConciliacao;
  const minimo = calcularMinimoPosseCobrancaMs({
    loteConciliacao: params.loteConciliacao,
    loteCriacao: params.loteCriacao,
    loteExpiracao,
    mpRequestTimeoutMs: params.mpRequestTimeoutMs,
  });

  if (params.overrideMs !== undefined && !Number.isNaN(params.overrideMs)) {
    if (params.validarOverride === true) {
      validarOverridePosse(
        'COBRANCA_REIVINDICACAO_MS',
        params.overrideMs,
        minimo,
      );
    }
    return params.overrideMs;
  }

  return minimo;
}

/**
 * Tempo máximo por item dentro de um único ciclo `reivindicarEmAndamento` + `executar`.
 * Retentativas que chamam `adiarProcessamento` (indeterminado, 409 AGUARDAR) pertencem a ciclos posteriores.
 */
export function calcularTempoOperacaoFinanceiraMesmaReivindicacaoMs(params: {
  mpRequestTimeoutMs: number;
  mpRetryBackoffMs?: number;
  margemGravacaoMs?: number;
}): number {
  const margem = params.margemGravacaoMs ?? MARGEM_GRAVACAO_MS;
  const chamadas = Math.max(
    CHAMADAS_MP_CONSULTA_FINANCEIRA_POR_EXECUCAO,
    CHAMADAS_MP_CANCELAMENTO_FINANCEIRO_POR_EXECUCAO,
  );
  const backoff = params.mpRetryBackoffMs ?? 0;
  return chamadas * params.mpRequestTimeoutMs + backoff + margem;
}

/** Posse mínima para cancelamento financeiro e consulta (mesmo processador). */
export function calcularPosseCancelamentoFinanceiroMs(params: {
  lote: number;
  mpRequestTimeoutMs: number;
  mpRetryBackoffMs?: number;
  overrideMs?: number;
  validarOverride?: boolean;
}): number {
  const minimo = calcularMinimoPosseCancelamentoFinanceiroMs({
    lote: params.lote,
    mpRequestTimeoutMs: params.mpRequestTimeoutMs,
    mpRetryBackoffMs: params.mpRetryBackoffMs,
  });

  if (params.overrideMs !== undefined && !Number.isNaN(params.overrideMs)) {
    if (params.validarOverride === true) {
      validarOverridePosse(
        'CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS',
        params.overrideMs,
        minimo,
      );
    }
    return params.overrideMs;
  }

  return minimo;
}

export function calcularMinimoPosseCancelamentoFinanceiroMs(params: {
  lote: number;
  mpRequestTimeoutMs: number;
  mpRetryBackoffMs?: number;
}): number {
  const porItem = calcularTempoOperacaoFinanceiraMesmaReivindicacaoMs({
    mpRequestTimeoutMs: params.mpRequestTimeoutMs,
    mpRetryBackoffMs: params.mpRetryBackoffMs,
  });
  return params.lote * porItem;
}

export function overridePosseInsuficiente(
  overrideMs: number,
  minimoCalculadoMs: number,
): boolean {
  return overrideMs < minimoCalculadoMs;
}

function validarOverridePosse(
  variavel: string,
  valorMs: number,
  minimoMs: number,
): void {
  if (overridePosseInsuficiente(valorMs, minimoMs)) {
    throw new ConfiguracaoReivindicacaoInvalidaError(
      variavel,
      valorMs,
      minimoMs,
    );
  }
}
