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
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO') return 'true';
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_INTERVAL_MS') return '60000';
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
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO') return 'true';
        if (chave === 'COBRANCA_CONCILIACAO_PROCESSADOR_INTERVAL_MS') return '60000';
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
});