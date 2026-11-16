import { ProcessadorOperacoesFinanceirasService } from './processador-operacoes-financeiras.service';

describe('ProcessadorOperacoesFinanceirasService', () => {
  it('processa operações reivindicadas', async () => {
    const executarCancelamento = { executar: jest.fn() };
    const executarConsulta = { executar: jest.fn() };
    const operacoes = {
      reivindicarEmAndamento: jest.fn().mockResolvedValue([
        { id: 'op1', tipo: 'CANCELAMENTO_FINANCEIRO' },
        { id: 'op2', tipo: 'CONSULTA_SITUACAO_FINANCEIRA' },
      ]),
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
      executarCancelamento as never,
      executarConsulta as never,
      operacoes as never,
    );
    await servico.processarLote();
    expect(executarCancelamento.executar).toHaveBeenCalledTimes(1);
    expect(executarConsulta.executar).toHaveBeenCalledTimes(1);
  });

  it('não processa quando desabilitado', async () => {
    const executarCancelamento = { executar: jest.fn() };
    const executarConsulta = { executar: jest.fn() };
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
      executarCancelamento as never,
      executarConsulta as never,
      operacoes as never,
    );
    servico.onModuleInit();
    expect((servico as { intervalo?: unknown }).intervalo).toBeUndefined();
  });

  it('inicia intervalo quando habilitado', () => {
    const config = {
      get: (chave: string) => {
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_INTERVAL_MS')
          return '5000';
        return undefined;
      },
    };
    const servico = new ProcessadorOperacoesFinanceirasService(
      config as never,
      { executar: jest.fn() } as never,
      { executar: jest.fn() } as never,
      { reivindicarEmAndamento: jest.fn() } as never,
    );
    servico.onModuleInit();
    expect((servico as { intervalo?: unknown }).intervalo).toBeDefined();
    servico.onModuleDestroy();
  });

  it('lote vazio não chama executar', async () => {
    const executarCancelamento = { executar: jest.fn() };
    const executarConsulta = { executar: jest.fn() };
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
      executarCancelamento as never,
      executarConsulta as never,
      operacoes as never,
    );
    await servico.processarLote();
    expect(executarCancelamento.executar).not.toHaveBeenCalled();
    expect(executarConsulta.executar).not.toHaveBeenCalled();
  });
});
