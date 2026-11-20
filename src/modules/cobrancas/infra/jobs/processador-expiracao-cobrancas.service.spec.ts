import { ProcessadorExpiracaoCobrancasService } from './processador-expiracao-cobrancas.service';

describe('ProcessadorExpiracaoCobrancasService', () => {
  it('expira cobranças reivindicadas quando habilitado', async () => {
    const expirar = { expirarPorCobrancaId: jest.fn() };
    const cobrancas = {
      reivindicarPendentesExpiracao: jest
        .fn()
        .mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
    };
    const config = {
      get: (chave: string) => {
        if (chave === 'COBRANCA_EXPIRACAO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'COBRANCA_EXPIRACAO_PROCESSADOR_LOTE') return '5';
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_LOTE') return '10';
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_LOTE') return '5';
        if (chave === 'MP_REQUEST_TIMEOUT_MS') return '30000';
        return '10000';
      },
    };
    const servico = new ProcessadorExpiracaoCobrancasService(
      config as never,
      expirar as never,
      cobrancas as never,
    );
    await servico.processarLote();
    expect(expirar.expirarPorCobrancaId).toHaveBeenCalledTimes(2);
  });

  it('inicia intervalo quando habilitado', () => {
    const config = {
      get: (chave: string) => {
        if (chave === 'COBRANCA_EXPIRACAO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'COBRANCA_EXPIRACAO_PROCESSADOR_INTERVAL_MS')
          return '5000';
        return '10';
      },
    };
    const servico = new ProcessadorExpiracaoCobrancasService(
      config as never,
      { expirarPorCobrancaId: jest.fn() } as never,
      { reivindicarPendentesExpiracao: jest.fn() } as never,
    );
    servico.onModuleInit();
    expect((servico as { intervalo?: unknown }).intervalo).toBeDefined();
    servico.onModuleDestroy();
  });

  it('ignora cobrança sem id no lote', async () => {
    const expirar = { expirarPorCobrancaId: jest.fn() };
    const cobrancas = {
      reivindicarPendentesExpiracao: jest
        .fn()
        .mockResolvedValue([{ id: undefined }]),
    };
    const config = {
      get: (chave: string) =>
        chave === 'COBRANCA_EXPIRACAO_PROCESSADOR_HABILITADO' ? 'true' : '10',
    };
    const servico = new ProcessadorExpiracaoCobrancasService(
      config as never,
      expirar as never,
      cobrancas as never,
    );
    await servico.processarLote();
    expect(expirar.expirarPorCobrancaId).not.toHaveBeenCalled();
  });

  it('não inicia intervalo quando desabilitado', () => {
    const config = {
      get: (chave: string) =>
        chave === 'COBRANCA_EXPIRACAO_PROCESSADOR_HABILITADO' ? 'false' : '10',
    };
    const servico = new ProcessadorExpiracaoCobrancasService(
      config as never,
      { expirarPorCobrancaId: jest.fn() } as never,
      { reivindicarPendentesExpiracao: jest.fn() } as never,
    );
    servico.onModuleInit();
    expect((servico as { intervalo?: unknown }).intervalo).toBeUndefined();
  });

  it('a falha de uma cobrança não interrompe as demais e fica registrada', async () => {
    const dependencia = {
      expirarPorCobrancaId: jest
        .fn()
        .mockRejectedValueOnce(new Error('falha em c1'))
        .mockResolvedValue(undefined),
    };
    const cobrancas = {
      reivindicarPendentesExpiracao: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          ordemServicoId: 'os1',
          rodada: 2,
          correlationId: 'corr1',
        },
        { id: 'c2', ordemServicoId: 'os2', rodada: 1, correlationId: 'corr2' },
      ]),
    };
    const servico = new ProcessadorExpiracaoCobrancasService(
      { get: () => undefined } as never,
      dependencia as never,
      cobrancas as never,
    );
    const erros = jest
      .spyOn(
        (servico as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await servico.processarLote();

    expect(dependencia.expirarPorCobrancaId).toHaveBeenCalledTimes(2);
    expect(dependencia.expirarPorCobrancaId).toHaveBeenLastCalledWith('c2');
    expect(JSON.parse(erros.mock.calls[0][0] as string)).toEqual({
      evento: 'falha_item_lote',
      processador: 'ProcessadorExpiracaoCobrancasService',
      itemId: 'c1',
      ordemServicoId: 'os1',
      rodada: 2,
      correlationId: 'corr1',
      erro: 'Error',
    });
  });
});
