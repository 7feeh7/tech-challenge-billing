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
      { processar: jest.fn(), adiarNovaTentativa: jest.fn() } as never,
      { reivindicarEmAndamento: jest.fn().mockResolvedValue([]) } as never,
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
      { processar: jest.fn(), adiarNovaTentativa: jest.fn() } as never,
      { reivindicarEmAndamento: jest.fn().mockResolvedValue([]) } as never,
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
      { processar: jest.fn(), adiarNovaTentativa: jest.fn() } as never,
      { reivindicarEmAndamento: jest.fn().mockResolvedValue([]) } as never,
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
      { processar: jest.fn(), adiarNovaTentativa: jest.fn() } as never,
      { reivindicarEmAndamento: jest.fn().mockResolvedValue([]) } as never,
    );
    await servico.processarLote();
    expect(executarCancelamento.executar).not.toHaveBeenCalled();
    expect(executarConsulta.executar).not.toHaveBeenCalled();
  });

  describe('isolamento por item do lote', () => {
    const config = {
      get: (chave: string) => {
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO')
          return 'true';
        if (chave === 'CANCELAMENTO_FINANCEIRO_PROCESSADOR_LOTE') return '3';
        if (chave === 'MP_REQUEST_TIMEOUT_MS') return '1000';
        if (chave === 'CANCELAMENTO_FINANCEIRO_RETRY_MP_MS') return '45000';
        return undefined;
      },
    };

    function operacao(id: string) {
      return {
        id,
        tipo: 'CANCELAMENTO_FINANCEIRO',
        ordemServicoId: `os-${id}`,
        rodada: 1,
        correlationId: `corr-${id}`,
      };
    }

    function montar(opcoes: {
      operacoes?: ReturnType<typeof operacao>[];
      estornos?: Array<{ id: string }>;
      executarCancelamento?: jest.Mock;
      adiarOperacao?: jest.Mock;
      processarEstorno?: jest.Mock;
      adiarEstorno?: jest.Mock;
    }) {
      const executarCancelamento =
        opcoes.executarCancelamento ?? jest.fn().mockResolvedValue(undefined);
      const operacoes = {
        reivindicarEmAndamento: jest
          .fn()
          .mockResolvedValue(opcoes.operacoes ?? []),
        adiarProcessamento: opcoes.adiarOperacao ?? jest.fn(),
      };
      const executarEstorno = {
        processar: opcoes.processarEstorno ?? jest.fn(),
        adiarNovaTentativa: opcoes.adiarEstorno ?? jest.fn(),
      };
      const estornos = {
        reivindicarEmAndamento: jest
          .fn()
          .mockResolvedValue(opcoes.estornos ?? []),
      };
      const servico = new ProcessadorOperacoesFinanceirasService(
        config as never,
        { executar: executarCancelamento } as never,
        { executar: jest.fn() } as never,
        operacoes as never,
        executarEstorno as never,
        estornos as never,
      );
      const erros = jest
        .spyOn(
          (servico as unknown as { logger: { error: () => void } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);
      return {
        servico,
        executarCancelamento,
        operacoes,
        executarEstorno,
        erros,
      };
    }

    it('a falha de uma operação não interrompe as demais', async () => {
      const executarCancelamento = jest
        .fn()
        .mockRejectedValueOnce(new Error('falha na op1'))
        .mockResolvedValue(undefined);
      const { servico } = montar({
        operacoes: [operacao('op1'), operacao('op2'), operacao('op3')],
        executarCancelamento,
      });

      await servico.processarLote();

      expect(executarCancelamento.mock.calls.map(([id]) => id)).toEqual([
        'op1',
        'op2',
        'op3',
      ]);
    });

    it('libera a operação com falha para nova tentativa com espera e registra log estruturado', async () => {
      const { servico, operacoes, erros } = montar({
        operacoes: [operacao('op1')],
        executarCancelamento: jest.fn().mockRejectedValue(new Error('segredo')),
      });
      const antes = Date.now();

      await servico.processarLote();

      const [id, ate] = operacoes.adiarProcessamento.mock.calls[0];
      expect(id).toBe('op1');
      expect((ate as Date).getTime()).toBeGreaterThanOrEqual(antes + 45_000);
      const [mensagem] = erros.mock.calls[0];
      expect(JSON.parse(mensagem as string)).toEqual({
        evento: 'falha_item_lote',
        processador: 'ProcessadorOperacoesFinanceirasService',
        itemId: 'op1',
        ordemServicoId: 'os-op1',
        rodada: 1,
        correlationId: 'corr-op1',
        erro: 'Error',
      });
      expect(mensagem).not.toContain('segredo');
    });

    it('registra e segue quando liberar a operação também falha', async () => {
      const { servico, erros, executarCancelamento } = montar({
        operacoes: [operacao('op1'), operacao('op2')],
        executarCancelamento: jest
          .fn()
          .mockRejectedValueOnce(new Error('falha'))
          .mockResolvedValue(undefined),
        adiarOperacao: jest.fn().mockRejectedValue(new Error('banco fora')),
      });

      await servico.processarLote();

      expect(executarCancelamento).toHaveBeenCalledTimes(2);
      expect(erros).toHaveBeenCalledTimes(2);
    });

    it('processa os estornos automáticos reivindicados', async () => {
      const { servico, executarEstorno } = montar({
        estornos: [{ id: 'e1' }, { id: 'e2' }],
      });

      await servico.processarLote();

      expect(executarEstorno.processar.mock.calls.map(([e]) => e.id)).toEqual([
        'e1',
        'e2',
      ]);
    });

    it('isola a falha de um estorno automático e o libera para nova tentativa', async () => {
      const processarEstorno = jest
        .fn()
        .mockRejectedValueOnce(new Error('falha'))
        .mockResolvedValue(undefined);
      const { servico, executarEstorno, erros } = montar({
        estornos: [{ id: 'e1' }, { id: 'e2' }],
        processarEstorno,
      });

      await servico.processarLote();

      expect(processarEstorno).toHaveBeenCalledTimes(2);
      expect(executarEstorno.adiarNovaTentativa).toHaveBeenCalledWith('e1');
      expect(JSON.parse(erros.mock.calls[0][0] as string).itemId).toBe('e1');
    });

    it('registra e segue quando liberar o estorno automático também falha', async () => {
      const { servico, processarEstorno, erros } = (() => {
        const processarEstorno = jest
          .fn()
          .mockRejectedValueOnce(new Error('falha'))
          .mockResolvedValue(undefined);
        const montado = montar({
          estornos: [{ id: 'e1' }, { id: 'e2' }],
          processarEstorno,
          adiarEstorno: jest.fn().mockRejectedValue(new Error('banco fora')),
        });
        return { ...montado, processarEstorno };
      })();

      await servico.processarLote();

      expect(processarEstorno).toHaveBeenCalledTimes(2);
      expect(erros).toHaveBeenCalledTimes(2);
    });
  });
});
