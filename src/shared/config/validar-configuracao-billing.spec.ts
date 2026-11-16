import { ConfiguracaoReivindicacaoInvalidaError } from './configuracao-reivindicacao-invalida.error';
import { validarConfiguracaoBilling } from './validar-configuracao-billing';

describe('validarConfiguracaoBilling', () => {
  const baseDev = {
    NODE_ENV: 'development',
    COBRANCA_CRIACAO_PROCESSADOR_LOTE: '5',
    COBRANCA_CONCILIACAO_PROCESSADOR_LOTE: '10',
    COBRANCA_EXPIRACAO_PROCESSADOR_LOTE: '10',
    CANCELAMENTO_FINANCEIRO_PROCESSADOR_LOTE: '5',
    MP_REQUEST_TIMEOUT_MS: '30000',
    OS_REQUEST_TIMEOUT_MS: '3000',
    OS_REQUEST_MAX_TENTATIVAS: '3',
  };

  it('aceita ausência de overrides em desenvolvimento', () => {
    expect(() => validarConfiguracaoBilling(baseDev)).not.toThrow();
  });

  it('rejeita COBRANCA_REIVINDICACAO_MS abaixo do mínimo quando definido', () => {
    expect(() =>
      validarConfiguracaoBilling({
        ...baseDev,
        COBRANCA_REIVINDICACAO_MS: '35000',
      }),
    ).toThrow(ConfiguracaoReivindicacaoInvalidaError);
  });

  it('aceita overrides válidos em desenvolvimento', () => {
    expect(() =>
      validarConfiguracaoBilling({
        ...baseDev,
        COBRANCA_REIVINDICACAO_MS: '950000',
        APROVACAO_REIVINDICACAO_MS: '150000',
        CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS: '775000',
        CANCELAMENTO_FINANCEIRO_RETRY_MP_MS: '30000',
        OUTBOX_REIVINDICACAO_MS: '350000',
      }),
    ).not.toThrow();
  });

  it('rejeita CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS abaixo do mínimo (625000 legado)', () => {
    expect(() =>
      validarConfiguracaoBilling({
        ...baseDev,
        CANCELAMENTO_FINANCEIRO_RETRY_MP_MS: '30000',
        CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS: '625000',
      }),
    ).toThrow(ConfiguracaoReivindicacaoInvalidaError);
  });

  it('rejeita override quando aumento do lote de expiração exige posse maior', () => {
    expect(() =>
      validarConfiguracaoBilling({
        ...baseDev,
        COBRANCA_EXPIRACAO_PROCESSADOR_LOTE: '10',
        COBRANCA_REIVINDICACAO_MS: '900000',
      }),
    ).toThrow(ConfiguracaoReivindicacaoInvalidaError);
  });

  it('rejeita lote de expiração maior que o de conciliação', () => {
    expect(() =>
      validarConfiguracaoBilling({
        ...baseDev,
        COBRANCA_EXPIRACAO_PROCESSADOR_LOTE: '15',
      }),
    ).toThrow(/COBRANCA_EXPIRACAO_PROCESSADOR_LOTE/);
  });

  it('aceita valores do ConfigMap de produção', () => {
    expect(() =>
      validarConfiguracaoBilling({
        NODE_ENV: 'production',
        COBRANCA_CRIACAO_PROCESSADOR_LOTE: '5',
        COBRANCA_CONCILIACAO_PROCESSADOR_LOTE: '10',
        COBRANCA_EXPIRACAO_PROCESSADOR_LOTE: '10',
        CANCELAMENTO_FINANCEIRO_PROCESSADOR_LOTE: '5',
        MP_REQUEST_TIMEOUT_MS: '30000',
        OS_REQUEST_TIMEOUT_MS: '3000',
        OS_REQUEST_MAX_TENTATIVAS: '3',
        SQS_CONSUMER_HABILITADO: 'true',
        OUTBOX_PUBLISHER_HABILITADO: 'true',
        APROVACAO_PROCESSADOR_HABILITADO: 'true',
        COBRANCA_CRIACAO_PROCESSADOR_HABILITADO: 'true',
        COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO: 'true',
        COBRANCA_EXPIRACAO_PROCESSADOR_HABILITADO: 'true',
        CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO: 'true',
        APROVACAO_REIVINDICACAO_MS: '150000',
        COBRANCA_REIVINDICACAO_MS: '950000',
        CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS: '775000',
        CANCELAMENTO_FINANCEIRO_RETRY_MP_MS: '30000',
        OUTBOX_REIVINDICACAO_MS: '350000',
      }),
    ).not.toThrow();
  });

  it('exige processadores ligados em produção', () => {
    expect(() =>
      validarConfiguracaoBilling({
        ...baseDev,
        NODE_ENV: 'production',
        SQS_CONSUMER_HABILITADO: 'true',
        OUTBOX_PUBLISHER_HABILITADO: 'true',
        APROVACAO_PROCESSADOR_HABILITADO: 'true',
        COBRANCA_CRIACAO_PROCESSADOR_HABILITADO: 'true',
        COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO: 'true',
        COBRANCA_EXPIRACAO_PROCESSADOR_HABILITADO: 'true',
        CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO: 'false',
        COBRANCA_REIVINDICACAO_MS: '950000',
        APROVACAO_REIVINDICACAO_MS: '150000',
        CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS: '775000',
        CANCELAMENTO_FINANCEIRO_RETRY_MP_MS: '30000',
        OUTBOX_REIVINDICACAO_MS: '350000',
      }),
    ).toThrow(/CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO/);
  });
});
