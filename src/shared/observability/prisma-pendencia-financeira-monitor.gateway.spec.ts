import { Logger } from '@nestjs/common';
import { PrismaPendenciaFinanceiraMonitorGateway } from './prisma-pendencia-financeira-monitor.gateway';

describe('PrismaPendenciaFinanceiraMonitorGateway', () => {
  it('registra pendência persistida e métrica estruturada D7.3', async () => {
    const create = jest.fn();
    const updateMany = jest.fn();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const gateway = new PrismaPendenciaFinanceiraMonitorGateway({
      pendenciaFinanceiraMonitoramento: { create, updateMany },
    } as never);

    await gateway.registrar({
      tipo: 'SITUACAO_FINANCEIRA_INDETERMINADA',
      operacaoId: 'op1',
      cobrancaId: 'c1',
      ordemServicoId: 'os1',
      rodada: 1,
      correlationId: 'corr',
      motivo: 'timeout',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'SITUACAO_FINANCEIRA_INDETERMINADA',
          operacaoId: 'op1',
          ordemServicoId: 'os1',
        }),
      }),
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      metric: 'billing.situacao_financeira_indeterminada',
      ordemServicoId: 'os1',
      rodada: 1,
      correlationId: 'corr',
      operacaoId: 'op1',
      cobrancaId: 'c1',
      motivo: 'timeout',
    });

    log.mockRestore();
  });

  it('resolve pendência por operação', async () => {
    const updateMany = jest.fn();
    const gateway = new PrismaPendenciaFinanceiraMonitorGateway({
      pendenciaFinanceiraMonitoramento: {
        create: jest.fn(),
        updateMany,
      },
    } as never);
    await gateway.resolverPorOperacao('op1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operacaoId: 'op1', resolvidoEm: null },
      }),
    );
  });
});
