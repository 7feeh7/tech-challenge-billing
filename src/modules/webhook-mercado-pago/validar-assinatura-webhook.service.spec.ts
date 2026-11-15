import { ValidarAssinaturaWebhookService } from './validar-assinatura-webhook.service';

describe('ValidarAssinaturaWebhookService', () => {
  const servico = new ValidarAssinaturaWebhookService();
  const segredo = 'segredo-prova-teste';
  const dataId = 'ORDTST01M7GH2KEG5AH9PXBNF8S3AQ8A';
  const requestId = '550e8400-e29b-41d4-a716-446655440099';

  it('aceita assinatura válida gerada com o mesmo segredo', () => {
    const assinatura = servico.gerarAssinaturaParaProva(
      dataId,
      requestId,
      segredo,
    );

    const resultado = servico.validar({
      dataId,
      requestId,
      assinaturaCabecalho: assinatura,
      segredo,
    });

    expect(resultado.valida).toBe(true);
  });

  it('rejeita cabeçalho x-signature malformado', () => {
    const resultado = servico.validar({
      dataId,
      requestId,
      assinaturaCabecalho: 'sem-formato-valido',
      segredo,
    });

    expect(resultado.valida).toBe(false);
    expect(resultado.motivo).toBe('formato_invalido');
  });

  it('rejeita assinatura com hash incorreto', () => {
    const assinatura = servico.gerarAssinaturaParaProva(
      dataId,
      requestId,
      segredo,
    );
    const adulterada = assinatura.replace(/v1=[a-f0-9]+/, 'v1=0'.repeat(16));

    const resultado = servico.validar({
      dataId,
      requestId,
      assinaturaCabecalho: adulterada,
      segredo: 'outro-segredo',
    });

    expect(resultado.valida).toBe(false);
    expect(resultado.motivo).toBe('hash_invalido');
  });

  it('rejeita timestamp fora da tolerância', () => {
    const tsAntigo = Math.floor(Date.now() / 1000) - 10_000;
    const assinatura = servico.gerarAssinaturaParaProva(
      dataId,
      requestId,
      segredo,
      tsAntigo,
    );

    const resultado = servico.validar({
      dataId,
      requestId,
      assinaturaCabecalho: assinatura,
      segredo,
    });

    expect(resultado.valida).toBe(false);
    expect(resultado.motivo).toBe('timestamp_expirado');
  });

  it('rejeita quando x-request-id está ausente', () => {
    const assinatura = servico.gerarAssinaturaParaProva(
      dataId,
      requestId,
      segredo,
    );

    const resultado = servico.validar({
      dataId,
      requestId: undefined,
      assinaturaCabecalho: assinatura,
      segredo,
    });

    expect(resultado.valida).toBe(false);
    expect(resultado.motivo).toBe('formato_invalido');
  });

  it('rejeita quando o cabeçalho x-signature está ausente', () => {
    const resultado = servico.validar({
      dataId,
      requestId,
      assinaturaCabecalho: undefined,
      segredo,
    });

    expect(resultado.valida).toBe(false);
    expect(resultado.motivo).toBe('assinatura_ausente');
  });
});
