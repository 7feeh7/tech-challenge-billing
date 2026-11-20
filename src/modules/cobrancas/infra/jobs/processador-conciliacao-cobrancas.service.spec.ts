import { ProcessadorConciliacaoCobrancasService } from './processador-conciliacao-cobrancas.service';

describe('ProcessadorConciliacaoCobrancasService', () => {
  it('concilia cobranças pendentes reivindicadas', async () => {
    const conciliar = { conciliarPorCobrancaId: jest.fn() };
    const cobrancas = {
      reivindicarPendentesConciliacao: jest
        .fn()
        .mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
    };
    const config = {
      get: (chave: string) => {
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_INTERVAL_MS')
          return '60000';
        if (chave === 'COBRANCA_REIVINDICACAO_MS') return '30000';
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_LOTE') return '10';
        return undefined;
      },
    };
    const servico = new ProcessadorConciliacaoCobrancasService(
      config as never,
      conciliar as never,
      cobrancas as never,
    );
    await servico.processarLote();
    expect(conciliar.conciliarPorCobrancaId).toHaveBeenCalledTimes(2);
  });

  it('inicia intervalo quando habilitado', () => {
    const config = {
      get: (chave: string) => {
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_INTERVAL_MS')
          return '60000';
        return '30000';
      },
    };
    const servico = new ProcessadorConciliacaoCobrancasService(
      config as never,
      { conciliarPorCobrancaId: jest.fn() } as never,
      { reivindicarPendentesConciliacao: jest.fn() } as never,
    );
    servico.onModuleInit();
    expect(servico['intervalo']).toBeDefined();
    servico.onModuleDestroy();
  });

  it('a falha de uma cobrança não interrompe as demais e fica registrada', async () => {
    const dependencia = {
      conciliarPorCobrancaId: jest
        .fn()
        .mockRejectedValueOnce(new Error('falha em c1'))
        .mockResolvedValue(undefined),
    };
    const cobrancas = {
      reivindicarPendentesConciliacao: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          ordemServicoId: 'os1',
          rodada: 2,
          correlationId: 'corr1',
        },
        { id: 'c2', ordemServicoId: 'os2', rodada: 1, correlationId: 'corr2' },
      ]),
    };
    const servico = new ProcessadorConciliacaoCobrancasService(
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

    expect(dependencia.conciliarPorCobrancaId).toHaveBeenCalledTimes(2);
    expect(dependencia.conciliarPorCobrancaId).toHaveBeenLastCalledWith('c2');
    expect(JSON.parse(erros.mock.calls[0][0] as string)).toEqual({
      evento: 'falha_item_lote',
      processador: 'ProcessadorConciliacaoCobrancasService',
      itemId: 'c1',
      ordemServicoId: 'os1',
      rodada: 2,
      correlationId: 'corr1',
      erro: 'Error',
    });
  });
});
