/**
 * Consolida cenários de consistência financeira da E18 (dubles MP; sem E04/E05).
 */

import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import { SituacaoCobranca } from '@/modules/cobrancas/domain/situacao-cobranca';
import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { EVENTO_CANCELAR_FINANCEIRO } from '@/shared/messaging/envelope';
import { ProcessarCancelarFinanceiroUseCase } from '../use-cases/processar-cancelar-financeiro.use-case';
import { ExecutarCancelamentoFinanceiroService } from './executar-cancelamento-financeiro.service';

describe('Consistência financeira E18 (cancelamento)', () => {
  const cobrancaPendente = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 5000,
    prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
    situacao: SituacaoCobranca.PENDENTE,
    linkPagamento: 'https://checkout',
  });

  const operacao = {
    id: 'op1',
    eventId: 'ev1',
    ordemServicoId: 'os1',
    rodada: 1,
    correlationId: 'corr',
    tipo: 'CANCELAMENTO_FINANCEIRO' as const,
    situacao: 'EM_ANDAMENTO' as const,
    chaveIdempotenciaMercadoPago: 'chave-fixa',
    resultadoExecucao: 'REPARO_NAO_INICIADO' as const,
    tentativasMercadoPago: 0,
  };

  it('cancelamento sem pagamento: order cancelada na MP e cobrança CANCELADA', async () => {
    const cancelarOrder = jest.fn().mockResolvedValue({ tipo: 'sucesso' });
    const consultarOrder = jest.fn().mockResolvedValue({
      tipo: 'sucesso',
      order: { id: 'ORD1', status: 'canceled', pagamentos: [] },
    });
    const servico = new ExecutarCancelamentoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluir: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      { buscarPorOrdemServicoERodadaLeitura: jest.fn() } as never,
      {
        buscarPorOrdemServicoERodada: jest
          .fn()
          .mockResolvedValue(cobrancaPendente),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPendente),
        atualizar: jest.fn(),
      } as never,
      { obterPorCobrancaId: jest.fn() } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
      } as never,
      { cancelarOrder, consultarOrder, estornarTotal: jest.fn() } as never,
      { criar: jest.fn() } as never,
      { registrar: jest.fn() } as never,
      100,
      5,
      50,
    );
    await servico.executar('op1');
    expect(cancelarOrder).toHaveBeenCalledWith('ORD1', 'chave-fixa');
    expect(consultarOrder).toHaveBeenCalled();
  });

  it('reentrega CancelarFinanceiro: mesma operação não duplica criação', async () => {
    const criar = jest.fn();
    const envelope = {
      eventId: 'ev-dup',
      eventType: EVENTO_CANCELAR_FINANCEIRO,
      version: 1,
      occurredAt: new Date().toISOString(),
      source: 'os',
      correlationId: 'corr',
      causationId: null,
      ordemServicoId: 'os1',
      rodada: 1,
      payload: {
        etapaOrigem: 'X',
        motivo: 'm',
        resultadoExecucao: 'REPARO_NAO_INICIADO',
      },
    };
    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      { garantir: jest.fn() } as never,
      {
        buscarPorEventId: jest.fn().mockResolvedValue({ id: 'op-existente' }),
        criar,
      } as never,
      {
        jaProcessada: jest.fn().mockResolvedValue(false),
        registrar: jest.fn(),
      } as never,
    );
    await caso.processar(envelope);
    expect(criar).not.toHaveBeenCalled();
  });

  it('pagamento durante cancelamento: GET não confirma encerrada sem pagamento', async () => {
    const cancelarOrder = jest.fn().mockResolvedValue({ tipo: 'sucesso' });
    const consultarOrder = jest.fn().mockResolvedValue({
      tipo: 'sucesso',
      order: {
        id: 'ORD1',
        status: 'processed',
        status_detail: 'accredited',
        pagamentos: [],
      },
    });
    const adiar = jest.fn();
    const servico = new ExecutarCancelamentoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluir: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: adiar,
      } as never,
      { buscarPorOrdemServicoERodadaLeitura: jest.fn() } as never,
      {
        buscarPorOrdemServicoERodada: jest
          .fn()
          .mockResolvedValue(cobrancaPendente),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPendente),
        atualizar: jest.fn(),
      } as never,
      { obterPorCobrancaId: jest.fn() } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp',
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      { cancelarOrder, consultarOrder, estornarTotal: jest.fn() } as never,
      { criar: jest.fn() } as never,
      { registrar: jest.fn() } as never,
      100,
      5,
      50,
    );
    await servico.executar('op1');
    expect(adiar).toHaveBeenCalled();
    expect(cancelarOrder).toHaveBeenCalledWith('ORD1', 'chave-fixa');
  });

  it('timeout MP após cancel com sucesso: mesma chave na retentativa', async () => {
    const cancelarOrder = jest
      .fn()
      .mockResolvedValueOnce({ tipo: 'indeterminado', motivo: 'timeout' })
      .mockResolvedValueOnce({ tipo: 'sucesso' });
    const consultarOrder = jest.fn().mockResolvedValue({
      tipo: 'sucesso',
      order: { id: 'ORD1', status: 'canceled', pagamentos: [] },
    });
    const buscarPorId = jest
      .fn()
      .mockResolvedValueOnce({ ...operacao, tentativasMercadoPago: 0 })
      .mockResolvedValueOnce({ ...operacao, tentativasMercadoPago: 1 });
    const servico = new ExecutarCancelamentoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId,
        concluir: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      { buscarPorOrdemServicoERodadaLeitura: jest.fn() } as never,
      {
        buscarPorOrdemServicoERodada: jest
          .fn()
          .mockResolvedValue(cobrancaPendente),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPendente),
        atualizar: jest.fn(),
      } as never,
      { obterPorCobrancaId: jest.fn() } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp',
          mercadoPagoOrderId: 'ORD1',
        }),
        desativar: jest.fn(),
      } as never,
      { cancelarOrder, consultarOrder, estornarTotal: jest.fn() } as never,
      { criar: jest.fn() } as never,
      { registrar: jest.fn() } as never,
      100,
      5,
      50,
    );
    await servico.executar('op1');
    await servico.executar('op1');
    expect(cancelarOrder).toHaveBeenNthCalledWith(1, 'ORD1', 'chave-fixa');
    expect(cancelarOrder).toHaveBeenNthCalledWith(2, 'ORD1', 'chave-fixa');
  });

  it('estorno parcial: interpretação não conclui cancelamento automático', async () => {
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const estornarTotal = jest.fn().mockResolvedValue({ tipo: 'sucesso' });
    const consultarOrder = jest.fn().mockResolvedValue({
      tipo: 'sucesso',
      order: {
        id: 'ORD1',
        status: 'partially_refunded',
        pagamentos: [],
        refundedAmount: 2_000,
      },
    });
    const concluir = jest.fn();
    const servico = new ExecutarCancelamentoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluir,
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      { buscarPorOrdemServicoERodadaLeitura: jest.fn() } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
        atualizar: jest.fn(),
      } as never,
      { obterPorCobrancaId: jest.fn() } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp',
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        cancelarOrder: jest.fn(),
        consultarOrder,
        estornarTotal,
      } as never,
      { criar: jest.fn() } as never,
      { registrar: jest.fn() } as never,
      100,
      5,
      50,
    );
    await servico.executar('op1');
    expect(estornarTotal).toHaveBeenCalledWith('ORD1', 'chave-fixa');
    expect(concluir).not.toHaveBeenCalled();
  });

  it('indeterminado após max tentativas abre pendência sem nova chave MP', async () => {
    const estornarTotal = jest.fn().mockResolvedValue({
      tipo: 'indeterminado',
      motivo: 'timeout',
    });
    const pendenciaCriar = jest.fn().mockResolvedValue({ id: 'pend1' });
    const cobrancaPaga = new Cobranca({
      ...cobrancaPendente,
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date(),
    });
    const operacaoMax = {
      ...operacao,
      tentativasMercadoPago: 4,
      resultadoExecucao: 'REPARO_NAO_INICIADO' as const,
    };
    const servico = new ExecutarCancelamentoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacaoMax),
        concluir: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      { buscarPorOrdemServicoERodadaLeitura: jest.fn() } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobrancaPaga),
        buscarPorId: jest.fn().mockResolvedValue(cobrancaPaga),
        atualizar: jest.fn(),
      } as never,
      { obterPorCobrancaId: jest.fn() } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'omp',
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        cancelarOrder: jest.fn(),
        estornarTotal,
        consultarOrder: jest.fn(),
      } as never,
      { criar: pendenciaCriar } as never,
      { registrar: jest.fn() } as never,
      100,
      5,
      50,
    );
    await servico.executar('op1');
    expect(pendenciaCriar).toHaveBeenCalled();
    expect(estornarTotal).toHaveBeenCalledWith('ORD1', 'chave-fixa');
    expect(estornarTotal).toHaveBeenCalledTimes(1);
  });
});
