import { ConfigService } from '@nestjs/config';
import { ProcessadorAprovacoesPendentesService } from './processador-aprovacoes-pendentes.service';

describe('ProcessadorAprovacoesPendentesService', () => {
  it('reprocessa orçamentos reivindicados', async () => {
    const aprovar = { reprocessarPendente: jest.fn() };
    const orcamentos = {
      reivindicarAprovacoesPendentes: jest
        .fn()
        .mockResolvedValue([{ id: 'orc-1' }, { id: undefined }]),
    };
    const service = new ProcessadorAprovacoesPendentesService(
      {
        get: (k: string) =>
          ({
            APROVACAO_PROCESSADOR_HABILITADO: 'false',
            APROVACAO_PROCESSADOR_INTERVAL_MS: '10000',
            APROVACAO_REIVINDICACAO_MS: '35000',
          })[k],
      } as ConfigService,
      aprovar as never,
      orcamentos as never,
    );

    await service.processarLote();
    expect(aprovar.reprocessarPendente).toHaveBeenCalledTimes(1);
    expect(aprovar.reprocessarPendente).toHaveBeenCalledWith('orc-1');
  });

  it('a falha de um orçamento não interrompe os demais e fica registrada', async () => {
    const aprovar = {
      reprocessarPendente: jest
        .fn()
        .mockRejectedValueOnce(new Error('falha em orc-1'))
        .mockResolvedValue(undefined),
    };
    const orcamentos = {
      reivindicarAprovacoesPendentes: jest.fn().mockResolvedValue([
        {
          id: 'orc-1',
          ordemServicoId: 'os-1',
          rodada: 3,
          correlationId: 'corr-1',
        },
        {
          id: 'orc-2',
          ordemServicoId: 'os-2',
          rodada: 1,
          correlationId: 'corr-2',
        },
      ]),
    };
    const service = new ProcessadorAprovacoesPendentesService(
      { get: () => undefined } as unknown as ConfigService,
      aprovar as never,
      orcamentos as never,
    );
    const erros = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await service.processarLote();

    expect(aprovar.reprocessarPendente).toHaveBeenCalledTimes(2);
    expect(aprovar.reprocessarPendente).toHaveBeenLastCalledWith('orc-2');
    expect(JSON.parse(erros.mock.calls[0][0] as string)).toEqual({
      evento: 'falha_item_lote',
      processador: 'ProcessadorAprovacoesPendentesService',
      itemId: 'orc-1',
      ordemServicoId: 'os-1',
      rodada: 3,
      correlationId: 'corr-1',
      erro: 'Error',
    });
  });
});
