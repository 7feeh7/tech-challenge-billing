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
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_INTERVAL_MS') return '60000';
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
        if (chave === 'COBRANCA_CRIACAO_PROCESSADOR_INTERVAL_MS') return '60000';
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
});