export function calcularPrazoPagamento(
  prazoReferencia: Date,
  carenciaMinutos: number,
): Date {
  if (!Number.isFinite(carenciaMinutos) || carenciaMinutos < 0) {
    throw new Error('Carência inválida para cálculo do prazo de pagamento.');
  }
  return new Date(prazoReferencia.getTime() - carenciaMinutos * 60_000);
}

export function montarChaveReserva(
  orcamentoId: string,
  tentativaAprovacao: number,
): string {
  return `reserva:${orcamentoId}:${tentativaAprovacao}`;
}
