import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import { SituacaoCobranca } from '@/modules/cobrancas/domain/situacao-cobranca';
import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { EVENTO_SITUACAO_FINANCEIRA } from '@/shared/messaging/envelope';
import { ExecutarConsultaSituacaoFinanceiroService } from './executar-consulta-situacao-financeiro.service';

const operacaoConsulta = {
  id: 'op1',
  eventId: 'ev1',
  ordemServicoId: 'os1',
  rodada: 1,
  correlationId: 'corr',
  tipo: 'CONSULTA_SITUACAO_FINANCEIRA' as const,
  situacao: 'EM_ANDAMENTO' as const,
  chaveIdempotenciaMercadoPago: 'chave',
  consultaId: 'consulta-1',
  finalidadeConsulta: 'EXCECAO_E10' as const,
  tentativasMercadoPago: 0,
};

describe('ExecutarConsultaSituacaoFinanceiroService', () => {
  it('ignora operação inexistente ou concluída', async () => {
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      { buscarPorId: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      {} as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );
    await servico.executar('op1');
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('ignora operação que não é consulta', async () => {
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue({
          ...operacaoConsulta,
          tipo: 'CANCELAMENTO_FINANCEIRO',
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );
    await servico.executar('op1');
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('sem cobrança conclui consulta como INDETERMINADA', async () => {
    const concluirConsulta = jest.fn();
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacaoConsulta),
        concluirConsulta,
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(null),
      } as never,
      {} as never,
      {} as never,
      { registrar: jest.fn() } as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );
    await servico.executar('op1');
    expect(concluirConsulta).toHaveBeenCalledWith(
      expect.anything(),
      'op1',
      expect.objectContaining({ resultadoConsulta: 'INDETERMINADA' }),
    );
  });

  it('finalidade EXCECAO_E10 responde sem cancelar order', async () => {
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date('2020-01-01T00:00:00.000Z'),
    });
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacaoConsulta),
        concluirConsulta: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: {
            id: 'ORD1',
            status: 'processed',
            pagamentos: [
              {
                id: 'P1',
                status: 'accredited',
                dateApproved: '2020-01-01T00:00:00.000Z',
              },
            ],
          },
        }),
        cancelarOrder: jest.fn(),
      } as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );

    await servico.executar('op1');
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_SITUACAO_FINANCEIRA }),
    );
  });

  it('MP indisponível mantém operação e registra pendência', async () => {
    const operacao = {
      ...operacaoConsulta,
      finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO' as const,
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const monitor = { registrar: jest.fn(), resolverPorOperacao: jest.fn() };
    const adiar = jest.fn();
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluirConsulta: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: adiar,
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'indeterminado',
          motivo: 'timeout',
        }),
        cancelarOrder: jest.fn(),
      } as never,
      { registrar: jest.fn() } as never,
      monitor as never,
      5,
      1000,
    );

    await servico.executar('op1');
    expect(monitor.registrar).toHaveBeenCalled();
    expect(adiar).toHaveBeenCalled();
  });

  it('PRAZO_DE_REFERENCIA_VENCIDO responde SEM_PAGAMENTO após cancelamento confirmado', async () => {
    const operacao = {
      ...operacaoConsulta,
      finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO' as const,
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluirConsulta: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
        desativar: jest.fn(),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: {
            id: 'ORD1',
            status: 'canceled',
            statusDetail: 'expired',
            pagamentos: [],
          },
        }),
        cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      } as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );

    await servico.executar('op1');
    const envelope = (outbox.registrar as jest.Mock).mock.calls[0]?.[1]
      ?.envelope;
    expect(envelope?.payload?.situacaoPagamento).toBe('SEM_PAGAMENTO');
  });

  it('PRAZO_DE_REFERENCIA_VENCIDO com pagamento no prazo responde PAGO_NO_PRAZO', async () => {
    const operacao = {
      ...operacaoConsulta,
      finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO' as const,
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date('2020-01-01T00:00:00.000Z'),
    });
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluirConsulta: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: { id: 'ORD1', status: 'processed', pagamentos: [] },
        }),
        cancelarOrder: jest.fn(),
      } as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );

    await servico.executar('op1');
    const envelope = (outbox.registrar as jest.Mock).mock.calls[0]?.[1]
      ?.envelope;
    expect(envelope?.payload?.situacaoPagamento).toBe('PAGO_NO_PRAZO');
  });

  it('EXCECAO_E10 com cobrança expirada e sem order responde SEM_PAGAMENTO', async () => {
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.EXPIRADA,
    });
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacaoConsulta),
        concluirConsulta: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
      } as never,
      {} as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );
    await servico.executar('op1');
    const envelope = (outbox.registrar as jest.Mock).mock.calls[0]?.[1]
      ?.envelope;
    expect(envelope?.payload?.situacaoPagamento).toBe('SEM_PAGAMENTO');
  });

  it('cancelamento indeterminado registra pendência sem responder', async () => {
    const operacao = {
      ...operacaoConsulta,
      finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO' as const,
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const monitor = { registrar: jest.fn(), resolverPorOperacao: jest.fn() };
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluirConsulta: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'sucesso',
          order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
        }),
        cancelarOrder: jest.fn().mockResolvedValue({
          tipo: 'indeterminado',
          motivo: 'timeout',
        }),
      } as never,
      outbox as never,
      monitor as never,
      5,
      1000,
    );
    await servico.executar('op1');
    expect(monitor.registrar).toHaveBeenCalled();
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('pagamento após tentativa de cancelamento registra indeterminada', async () => {
    const operacao = {
      ...operacaoConsulta,
      finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO' as const,
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const monitor = { registrar: jest.fn(), resolverPorOperacao: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluirConsulta: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
        atualizar: jest.fn(),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          id: 'loc',
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
        desativar: jest.fn(),
      } as never,
      {
        consultarOrder: jest
          .fn()
          .mockResolvedValueOnce({
            tipo: 'sucesso',
            order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
          })
          .mockResolvedValueOnce({
            tipo: 'sucesso',
            order: {
              id: 'ORD1',
              status: 'processed',
              pagamentos: [
                {
                  id: 'P1',
                  status: 'accredited',
                  dateApproved: '2020-02-01T00:00:00.000Z',
                },
              ],
            },
          }),
        cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      } as never,
      { registrar: jest.fn() } as never,
      monitor as never,
      5,
      1000,
    );
    await servico.executar('op1');
    expect(monitor.registrar).toHaveBeenCalled();
  });

  it('confirmação indeterminada após cancelamento registra pendência', async () => {
    const operacao = {
      ...operacaoConsulta,
      finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO' as const,
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const monitor = { registrar: jest.fn(), resolverPorOperacao: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluirConsulta: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        consultarOrder: jest
          .fn()
          .mockResolvedValueOnce({
            tipo: 'sucesso',
            order: { id: 'ORD1', status: 'action_required', pagamentos: [] },
          })
          .mockResolvedValueOnce({
            tipo: 'indeterminado',
            motivo: 'timeout',
          }),
        cancelarOrder: jest.fn().mockResolvedValue({ tipo: 'sucesso' }),
      } as never,
      { registrar: jest.fn() } as never,
      monitor as never,
      5,
      1000,
    );
    await servico.executar('op1');
    expect(monitor.registrar).toHaveBeenCalled();
  });

  it('EXCECAO_E10 pendente sem order responde INDETERMINADA', async () => {
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacaoConsulta),
        concluirConsulta: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(null),
      } as never,
      {} as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );
    await servico.executar('op1');
    const envelope = (outbox.registrar as jest.Mock).mock.calls[0]?.[1]
      ?.envelope;
    expect(envelope?.payload?.situacaoPagamento).toBe('INDETERMINADA');
  });

  it('esgota tentativas MP e publica INDETERMINADA', async () => {
    const operacao = {
      ...operacaoConsulta,
      finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO' as const,
      tentativasMercadoPago: 4,
    };
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 1000,
      prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PENDENTE,
    });
    const outbox = { registrar: jest.fn() };
    const servico = new ExecutarConsultaSituacaoFinanceiroService(
      new UnitOfWorkFake(),
      {
        buscarPorId: jest.fn().mockResolvedValue(operacao),
        concluirConsulta: jest.fn(),
        incrementarTentativasMercadoPago: jest.fn(),
        adiarProcessamento: jest.fn(),
      } as never,
      {
        buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
      } as never,
      {
        buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
          mercadoPagoOrderId: 'ORD1',
          chaveIdempotencia: 'chave',
        }),
      } as never,
      {
        consultarOrder: jest.fn().mockResolvedValue({
          tipo: 'indeterminado',
          motivo: 'timeout',
        }),
        cancelarOrder: jest.fn(),
      } as never,
      outbox as never,
      { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
      5,
      1000,
    );
    await servico.executar('op1');
    const envelope = (outbox.registrar as jest.Mock).mock.calls[0]?.[1]
      ?.envelope;
    expect(envelope?.payload?.situacaoPagamento).toBe('INDETERMINADA');
  });
});
