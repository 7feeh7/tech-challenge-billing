import { ProcessadorCobrancasIntencaoService } from './processador-cobrancas-intencao.service';

describe('ProcessadorCobrancasIntencaoService', () => {
  it('não agenda intervalo quando desabilitado', () => {
    const config = {
      get: (chave: string) => {
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_HABILITADO') return 'false';
        return undefined;
      },
    };
    const servico = new ProcessadorCobrancasIntencaoService(
      config as never,
      { executar: jest.fn() } as never,
      { reivindicarIntencoesCriacaoOrder: jest.fn() } as never,
    );
    servico.onModuleInit();
    expect(servico['intervalo']).toBeUndefined();
  });

  it('processa lote reivindicado', async () => {
    const criar = { executar: jest.fn() };
    const cobrancas = {
      reivindicarIntencoesCriacaoOrder: jest
        .fn()
        .mockResolvedValue([{ id: 'c1' }]),
    };
    const config = {
      get: (chave: string) => {
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_HABILITADO') return 'true';
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_INTERVAL_MS')
          return '60000';
        if (chave === 'COBRANCA_REIVINDICACAO_MS') return '30000';
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_LOTE') return '5';
        return undefined;
      },
    };
    const servico = new ProcessadorCobrancasIntencaoService(
      config as never,
      criar as never,
      cobrancas as never,
    );
    await servico.processarLote();
    expect(criar.executar).toHaveBeenCalledWith('c1');
  });

  it('inicia intervalo quando habilitado', () => {
    const config = {
      get: (chave: string) => {
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_HABILITADO') return 'true';
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_INTERVAL_MS')
          return '60000';
        return '30000';
      },
    };
    const servico = new ProcessadorCobrancasIntencaoService(
      config as never,
      { executar: jest.fn() } as never,
      { reivindicarIntencoesCriacaoOrder: jest.fn() } as never,
    );
    servico.onModuleInit();
    expect(servico['intervalo']).toBeDefined();
    servico.onModuleDestroy();
  });

  it('a falha de uma cobrança não interrompe as demais e fica registrada', async () => {
    const dependencia = {
      executar: jest
        .fn()
        .mockRejectedValueOnce(new Error('falha em c1'))
        .mockResolvedValue(undefined),
    };
    const cobrancas = {
      reivindicarIntencoesCriacaoOrder: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          ordemServicoId: 'os1',
          rodada: 2,
          correlationId: 'corr1',
        },
        { id: 'c2', ordemServicoId: 'os2', rodada: 1, correlationId: 'corr2' },
      ]),
    };
    const servico = new ProcessadorCobrancasIntencaoService(
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

    expect(dependencia.executar).toHaveBeenCalledTimes(2);
    expect(dependencia.executar).toHaveBeenLastCalledWith('c2');
    expect(JSON.parse(erros.mock.calls[0][0] as string)).toEqual({
      evento: 'falha_item_lote',
      processador: 'ProcessadorCobrancasIntencaoService',
      itemId: 'c1',
      ordemServicoId: 'os1',
      rodada: 2,
      correlationId: 'corr1',
      erro: 'Error',
    });
  });
});
