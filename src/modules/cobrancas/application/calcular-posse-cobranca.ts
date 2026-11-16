export function calcularPosseProcessadorMs(params: {
  lote: number;
  chamadasMercadoPagoPorItem: number;
  mpRequestTimeoutMs: number;
  margemGravacaoMs?: number;
}): number {
  const margem = params.margemGravacaoMs ?? 5_000;
  return (
    params.lote *
    (params.chamadasMercadoPagoPorItem * params.mpRequestTimeoutMs + margem)
  );
}

/** Posse mínima para processadores de cobrança (criação + conciliação). */
export function calcularPosseCobrancaMs(params: {
  loteConciliacao: number;
  loteCriacao: number;
  mpRequestTimeoutMs: number;
  overrideMs?: number;
}): number {
  if (params.overrideMs !== undefined && !Number.isNaN(params.overrideMs)) {
    return params.overrideMs;
  }
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
  return Math.max(posseConciliacao, posseCriacao);
}

/** Posse mínima para cancelamento financeiro (cancelar/estornar + consultas por item do lote). */
export function calcularPosseCancelamentoFinanceiroMs(params: {
  lote: number;
  mpRequestTimeoutMs: number;
  overrideMs?: number;
}): number {
  if (params.overrideMs !== undefined && !Number.isNaN(params.overrideMs)) {
    return params.overrideMs;
  }
  return calcularPosseProcessadorMs({
    lote: params.lote,
    chamadasMercadoPagoPorItem: 4,
    mpRequestTimeoutMs: params.mpRequestTimeoutMs,
  });
}

export function overridePosseInsuficiente(
  overrideMs: number,
  minimoCalculadoMs: number,
): boolean {
  return overrideMs < minimoCalculadoMs;
}
