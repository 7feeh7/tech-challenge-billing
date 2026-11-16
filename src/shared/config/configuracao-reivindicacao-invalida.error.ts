export class ConfiguracaoReivindicacaoInvalidaError extends Error {
  constructor(
    public readonly variavel: string,
    public readonly valorMs: number,
    public readonly minimoMs: number,
  ) {
    super(
      `${variavel}=${valorMs} ms é menor que o mínimo calculado ${minimoMs} ms para o lote e timeouts configurados.`,
    );
    this.name = 'ConfiguracaoReivindicacaoInvalidaError';
  }
}
