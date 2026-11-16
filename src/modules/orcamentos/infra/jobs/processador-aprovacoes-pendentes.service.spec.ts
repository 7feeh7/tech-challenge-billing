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
});
