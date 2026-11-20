import {
  APROVACAO_LOTE_PADRAO,
  calcularMinimoPosseAprovacaoMs,
  calcularMinimoPosseCancelamentoFinanceiroMs,
  calcularMinimoPosseCobrancaMs,
  calcularMinimoPosseOutboxMs,
  OUTBOX_LOTE_PADRAO,
  overridePosseInsuficiente,
} from '@/modules/cobrancas/application/calcular-posse-cobranca';
import { ConfiguracaoReivindicacaoInvalidaError } from './configuracao-reivindicacao-invalida.error';

export type AmbienteConfiguracao = Record<string, string | undefined>;

function numero(
  ambiente: AmbienteConfiguracao,
  chave: string,
  padrao: number,
): number {
  const bruto = ambiente[chave]?.trim();
  if (!bruto) return padrao;
  const convertido = Number(bruto);
  return Number.isNaN(convertido) ? padrao : convertido;
}

function texto(
  ambiente: AmbienteConfiguracao,
  chave: string,
  padrao: string,
): string {
  const bruto = ambiente[chave]?.trim();
  return bruto && bruto.length > 0 ? bruto : padrao;
}

function exigirMinimoOverride(
  variavel: string,
  valorInformado: string | undefined,
  minimoMs: number,
): void {
  if (!valorInformado?.trim()) return;
  const overrideMs = Number(valorInformado);
  if (Number.isNaN(overrideMs)) {
    throw new ConfiguracaoReivindicacaoInvalidaError(
      variavel,
      Number.NaN,
      minimoMs,
    );
  }
  if (overridePosseInsuficiente(overrideMs, minimoMs)) {
    throw new ConfiguracaoReivindicacaoInvalidaError(
      variavel,
      overrideMs,
      minimoMs,
    );
  }
}

function exigirMinimoProducao(
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

/** Valida posse de reivindicação e lotes; em produção exige parâmetros compatíveis. */
export function validarConfiguracaoBilling(
  ambiente: AmbienteConfiguracao = process.env,
): void {
  const producao = texto(ambiente, 'NODE_ENV', 'development') === 'production';

  const osTimeout = numero(ambiente, 'OS_REQUEST_TIMEOUT_MS', 3_000);
  const osTentativas = numero(ambiente, 'OS_REQUEST_MAX_TENTATIVAS', 3);
  const mpTimeout = numero(ambiente, 'MP_REQUEST_TIMEOUT_MS', 30_000);

  const loteCriacao = numero(ambiente, 'COBRANCA_CRIACAO_PROCESSADOR_LOTE', 5);
  const loteConciliacao = numero(
    ambiente,
    'COBRANCA_CONCILIACAO_PROCESSADOR_LOTE',
    10,
  );
  const loteExpiracao = numero(
    ambiente,
    'COBRANCA_EXPIRACAO_PROCESSADOR_LOTE',
    10,
  );
  const loteCancelamento = numero(
    ambiente,
    'CANCELAMENTO_FINANCEIRO_PROCESSADOR_LOTE',
    5,
  );

  if (loteExpiracao > loteConciliacao) {
    throw new Error(
      `COBRANCA_EXPIRACAO_PROCESSADOR_LOTE (${loteExpiracao}) não pode ser maior que COBRANCA_CONCILIACAO_PROCESSADOR_LOTE (${loteConciliacao}).`,
    );
  }

  const minimoAprovacao = calcularMinimoPosseAprovacaoMs({
    lote: APROVACAO_LOTE_PADRAO,
    osRequestMaxTentativas: osTentativas,
    osRequestTimeoutMs: osTimeout,
  });
  const minimoCobranca = calcularMinimoPosseCobrancaMs({
    loteConciliacao,
    loteCriacao,
    loteExpiracao,
    mpRequestTimeoutMs: mpTimeout,
  });
  const mpRetryCancelamento = numero(
    ambiente,
    'CANCELAMENTO_FINANCEIRO_RETRY_MP_MS',
    30_000,
  );
  const minimoCancelamento = calcularMinimoPosseCancelamentoFinanceiroMs({
    lote: loteCancelamento,
    mpRequestTimeoutMs: mpTimeout,
    mpRetryBackoffMs: mpRetryCancelamento,
  });
  const minimoOutbox = calcularMinimoPosseOutboxMs({
    lote: OUTBOX_LOTE_PADRAO,
    sqsRequestTimeoutMs: mpTimeout,
  });

  exigirMinimoOverride(
    'APROVACAO_REIVINDICACAO_MS',
    ambiente.APROVACAO_REIVINDICACAO_MS,
    minimoAprovacao,
  );
  exigirMinimoOverride(
    'COBRANCA_REIVINDICACAO_MS',
    ambiente.COBRANCA_REIVINDICACAO_MS,
    minimoCobranca,
  );
  exigirMinimoOverride(
    'CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS',
    ambiente.CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS,
    minimoCancelamento,
  );
  exigirMinimoOverride(
    'OUTBOX_REIVINDICACAO_MS',
    ambiente.OUTBOX_REIVINDICACAO_MS,
    minimoOutbox,
  );

  if (!producao) return;

  const aprovacaoMs = numero(
    ambiente,
    'APROVACAO_REIVINDICACAO_MS',
    minimoAprovacao,
  );
  const cobrancaMs = numero(
    ambiente,
    'COBRANCA_REIVINDICACAO_MS',
    minimoCobranca,
  );
  const cancelamentoMs = numero(
    ambiente,
    'CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS',
    minimoCancelamento,
  );
  const outboxMs = numero(ambiente, 'OUTBOX_REIVINDICACAO_MS', minimoOutbox);

  exigirMinimoProducao(
    'APROVACAO_REIVINDICACAO_MS',
    aprovacaoMs,
    minimoAprovacao,
  );
  exigirMinimoProducao('COBRANCA_REIVINDICACAO_MS', cobrancaMs, minimoCobranca);
  exigirMinimoProducao(
    'CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS',
    cancelamentoMs,
    minimoCancelamento,
  );
  exigirMinimoProducao('OUTBOX_REIVINDICACAO_MS', outboxMs, minimoOutbox);

  const habilitados = [
    'SQS_CONSUMER_HABILITADO',
    'OUTBOX_PUBLISHER_HABILITADO',
    'APROVACAO_PROCESSADOR_HABILITADO',
    'COBRANCA_CRIACAO_PROCESSADOR_HABILITADO',
    'COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO',
    'COBRANCA_EXPIRACAO_PROCESSADOR_HABILITADO',
    'CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO',
  ] as const;

  for (const chave of habilitados) {
    if (texto(ambiente, chave, 'false') !== 'true') {
      throw new Error(
        `Em produção, ${chave} deve ser "true" (obrigatório na E20).`,
      );
    }
  }
}
