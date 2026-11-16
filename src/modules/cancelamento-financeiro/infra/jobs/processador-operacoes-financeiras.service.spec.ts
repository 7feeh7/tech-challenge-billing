import { ProcessadorOperacoesFinanceirasService } from './processador-operacoes-financeiras.service';

describe('ProcessadorOperacoesFinanceirasService', () => {
  it('processa operações reivindicadas', async () => {
    const executar = { executar: jest.fn() };
    const operacoes = {
      reivindicarEmAndamento: jest
        .fn()
        .mockResolvedValue([{ id: 'op1' }, { id: 'op2' }]),
    };
    const config = {
      get: (chave: string) => {
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_LOTE') return '5';
        if (chave === 'CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS')
          return '60000';
        return '10000';
      },
    };
    const servico = new ProcessadorOperacoesFinanceirasService(
      config as never,
      executar as never,
      operacoes as never,
    );
    await servico.processarLote();
    expect(executar.executar).toHaveBeenCalledTimes(2);
  });

  it('não processa quando desabilitado', async () => {
    const executar = { executar: jest.fn() };
    const operacoes = {
      reivindicarEmAndamento: jest.fn().mockResolvedValue([]),
    };
    const config = {
      get: (chave: string) => {
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO')
          return 'false';
        return undefined;
      },
    };
    const servico = new ProcessadorOperacoesFinanceirasService(
      config as never,
      executar as never,
      operacoes as never,
    );
    servico.onModuleInit();
    expect((servico as { intervalo?: unknown }).intervalo).toBeUndefined();
  });

  it('lote vazio não chama executar', async () => {
    const executar = { executar: jest.fn() };
    const operacoes = {
      reivindicarEmAndamento: jest.fn().mockResolvedValue([]),
    };
    const config = {
      get: (chave: string) => {
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_LOTE') return '3';
        if (chave === 'MP_REQUEST_TIMEOUT_MS') return '1000';
        return undefined;
      },
    };
    const servico = new ProcessadorOperacoesFinanceirasService(
      config as never,
      executar as never,
      operacoes as never,
    );
    await servico.processarLote();
    expect(executar.executar).not.toHaveBeenCalled();
  });
});
