const MINUTO_MS = 60_000;
const MIN_DURACAO_MINUTOS = 3;
const MAX_DURACAO_MINUTOS = 7 * 24 * 60;

/**
 * Converte o prazo de pagamento do Billing em duração ISO 8601 para a Orders API (comprovado E04 C05b).
 */
export function calcularExpirationTimeIso(
  prazoPagamento: Date,
  agora = new Date(),
): string {
  let minutos = Math.ceil(
    (prazoPagamento.getTime() - agora.getTime()) / MINUTO_MS,
  );
  if (minutos < MIN_DURACAO_MINUTOS) {
    minutos = MIN_DURACAO_MINUTOS;
  }
  if (minutos > MAX_DURACAO_MINUTOS) {
    minutos = MAX_DURACAO_MINUTOS;
  }
  return `PT${minutos}M`;
}

export function centavosParaValorMercadoPago(centavos: number): string {
  return (centavos / 100).toFixed(2);
}
