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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(null),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue(null),
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
        buscarQueConfirmouPagamento: jest.fn().mockResolvedValue({
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

  describe('leitura com order processed no formato real da Orders API', () => {
    // GET real (prova-tecnica/resultados/e05-w06-w08-*.json): o pagamento
    // aprovado vem processed/accredited, sem date_approved.
    const orderProcessedReal = {
      id: 'ORD1',
      status: 'processed',
      statusDetail: 'accredited',
      createdDate: '2026-11-15T22:18:32.827Z',
      pagamentos: [
        {
          id: 'PAY01M7GN4JNQ27FGP9YTXRP9TCG6',
          status: 'failed',
          statusDetail: 'insufficient_amount',
        },
        {
          id: 'PAY01M7GN7HTVMPN47J1BW52QB7B7',
          status: 'processed',
          statusDetail: 'accredited',
        },
      ],
    };

    const responderLeitura = async (prazoPagamento: Date) => {
      const cobranca = new Cobranca({
        id: 'c1',
        orcamentoId: 'o1',
        ordemServicoId: 'os1',
        rodada: 1,
        clienteId: 'cl1',
        correlationId: 'corr',
        valorTotalCentavos: 21200,
        prazoPagamento,
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
          buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue({
            mercadoPagoOrderId: 'ORD1',
          }),
        } as never,
        {
          consultarOrder: jest
            .fn()
            .mockResolvedValue({ tipo: 'sucesso', order: orderProcessedReal }),
          cancelarOrder: jest.fn(),
        } as never,
        outbox as never,
        { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
        5,
        1000,
      );

      await servico.executar('op1');
      return (outbox.registrar as jest.Mock).mock.calls[0]?.[1]?.envelope
        ?.payload?.situacaoPagamento;
    };

    it('order paga dentro do prazo responde PAGO_NO_PRAZO sem date_approved', async () => {
      const situacaoPagamento = await responderLeitura(
        new Date('2026-11-15T22:48:32.827Z'),
      );

      expect(situacaoPagamento).toBe('PAGO_NO_PRAZO');
    });

    it('order criada depois do prazo responde SEM_PAGAMENTO', async () => {
      const situacaoPagamento = await responderLeitura(
        new Date('2026-11-15T22:00:00.000Z'),
      );

      expect(situacaoPagamento).toBe('SEM_PAGAMENTO');
    });
  });

  describe('cobrança paga com segundo pagamento', () => {
    const paga = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl1',
      correlationId: 'corr',
      valorTotalCentavos: 5000,
      prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
      situacao: SituacaoCobranca.PAGA,
      pagamentoConfirmadoEm: new Date('2026-11-15T11:00:00.000Z'),
    });
    const orderLegitima = {
      id: 'omp1',
      mercadoPagoOrderId: 'ORD-LEGITIMA',
      chaveIdempotencia: 'k1',
      confirmouPagamento: true,
    };
    const orderSegunda = {
      id: 'omp2',
      mercadoPagoOrderId: 'ORD-SEGUNDA',
      chaveIdempotencia: 'k2',
    };
    const consultaPorOrder = {
      'ORD-LEGITIMA': {
        tipo: 'sucesso',
        order: {
          id: 'ORD-LEGITIMA',
          status: 'processed',
          pagamentos: [
            {
              id: 'P1',
              status: 'accredited',
              dateApproved: '2026-11-15T11:00:00.000Z',
            },
          ],
        },
      },
      'ORD-SEGUNDA': {
        tipo: 'sucesso',
        order: {
          id: 'ORD-SEGUNDA',
          status: 'refunded',
          pagamentos: [{ id: 'P2', status: 'refunded' }],
        },
      },
    } as Record<string, unknown>;

    function montar(
      finalidade: 'EXCECAO_E10' | 'PRAZO_DE_REFERENCIA_VENCIDO',
      ativa: unknown,
    ) {
      const mensagens: Array<{ envelope: { payload: any } }> = [];
      const consultarOrder = jest.fn(
        async (orderId: string) => consultaPorOrder[orderId],
      );
      const servico = new ExecutarConsultaSituacaoFinanceiroService(
        new UnitOfWorkFake(),
        {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoConsulta,
            finalidadeConsulta: finalidade,
          }),
          concluirConsulta: jest.fn(),
        } as never,
        {
          buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(paga),
        } as never,
        {
          buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(ativa),
          buscarQueConfirmouPagamento: jest
            .fn()
            .mockResolvedValue(orderLegitima),
        } as never,
        { consultarOrder, cancelarOrder: jest.fn() } as never,
        {
          registrar: jest.fn(async (_ctx, msg) => {
            mensagens.push(msg);
          }),
        } as never,
        { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
        5,
        1000,
      );
      return { servico, mensagens, consultarOrder };
    }

    it.each([
      ['PRAZO_DE_REFERENCIA_VENCIDO', orderSegunda],
      ['PRAZO_DE_REFERENCIA_VENCIDO', null],
      ['EXCECAO_E10', orderSegunda],
      ['EXCECAO_E10', null],
    ] as const)(
      'finalidade %s com order ativa %p responde com a order legítima',
      async (finalidade, ativa) => {
        const { servico, mensagens, consultarOrder } = montar(
          finalidade,
          ativa,
        );

        await servico.executar('op1');

        expect(consultarOrder).toHaveBeenCalledTimes(1);
        expect(consultarOrder).toHaveBeenCalledWith('ORD-LEGITIMA');
        expect(mensagens[0].envelope.payload).toMatchObject({
          situacaoPagamento: 'PAGO_NO_PRAZO',
          // 'REALIZADO' viria da order estornada do segundo pagamento.
          situacaoEstorno: 'INDETERMINADO',
          orderId: 'ORD-LEGITIMA',
          aprovadoEm: '2026-11-15T11:00:00.000Z',
        });
      },
    );
  });

  describe('cobrança com pagamento confirmado fora de PAGA', () => {
    const orderLegitima = {
      id: 'omp1',
      mercadoPagoOrderId: 'ORD-LEGITIMA',
      chaveIdempotencia: 'k1',
    };
    const orderSegunda = {
      id: 'omp2',
      mercadoPagoOrderId: 'ORD-SEGUNDA',
      chaveIdempotencia: 'k2',
    };
    const paga = (id: string, aprovadoEm: string) => ({
      tipo: 'sucesso',
      order: {
        id,
        status: 'processed',
        pagamentos: [
          { id: 'P', status: 'accredited', dateApproved: aprovadoEm },
        ],
      },
    });

    function montar(
      situacao: SituacaoCobranca,
      opcoes: { legitima?: unknown; aprovadoEm?: Date | null } = {},
    ) {
      const cobranca = new Cobranca({
        id: 'c1',
        orcamentoId: 'o1',
        ordemServicoId: 'os1',
        rodada: 1,
        clienteId: 'cl1',
        correlationId: 'corr',
        valorTotalCentavos: 5000,
        prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
        situacao,
        pagamentoConfirmadoEm:
          opcoes.aprovadoEm === undefined
            ? new Date('2026-11-15T11:00:00.000Z')
            : opcoes.aprovadoEm,
      });
      const mensagens: Array<{ envelope: { payload: any } }> = [];
      const consultarOrder = jest.fn(async (orderId: string) =>
        orderId === 'ORD-LEGITIMA'
          ? paga('ORD-LEGITIMA', '2026-11-15T11:00:00.000Z')
          : paga('ORD-SEGUNDA', '2026-11-15T12:00:00.000Z'),
      );
      const cancelarOrder = jest.fn();
      const servico = new ExecutarConsultaSituacaoFinanceiroService(
        new UnitOfWorkFake(),
        {
          buscarPorId: jest.fn().mockResolvedValue({
            ...operacaoConsulta,
            finalidadeConsulta: 'PRAZO_DE_REFERENCIA_VENCIDO',
          }),
          concluirConsulta: jest.fn(),
          incrementarTentativasMercadoPago: jest.fn(),
          adiarProcessamento: jest.fn(),
        } as never,
        {
          buscarPorOrdemServicoERodada: jest.fn().mockResolvedValue(cobranca),
        } as never,
        {
          buscarAtivaPorCobrancaId: jest.fn().mockResolvedValue(orderSegunda),
          buscarQueConfirmouPagamento: jest
            .fn()
            .mockResolvedValue(
              opcoes.legitima === undefined ? orderLegitima : opcoes.legitima,
            ),
          desativar: jest.fn(),
        } as never,
        { consultarOrder, cancelarOrder } as never,
        {
          registrar: jest.fn(async (_ctx, msg) => {
            mensagens.push(msg);
          }),
        } as never,
        { registrar: jest.fn(), resolverPorOperacao: jest.fn() } as never,
        5,
        1000,
      );
      return { servico, mensagens, consultarOrder, cancelarOrder };
    }

    it.each([
      [SituacaoCobranca.ESTORNADA, 'REALIZADO'],
      [SituacaoCobranca.PENDENCIA_MANUAL, 'REALIZADO'],
      [SituacaoCobranca.ESTORNO_EM_ANDAMENTO, 'EM_ANDAMENTO'],
    ] as const)(
      '%s: responde com a order legítima, sem consultar a ativa nem cancelar nada',
      async (situacao, estorno) => {
        const { servico, mensagens, consultarOrder, cancelarOrder } =
          montar(situacao);

        await servico.executar('op1');

        expect(consultarOrder).toHaveBeenCalledTimes(1);
        expect(consultarOrder).toHaveBeenCalledWith('ORD-LEGITIMA');
        expect(cancelarOrder).not.toHaveBeenCalled();
        expect(mensagens[0].envelope.payload).toMatchObject({
          situacaoPagamento: 'PAGO_NO_PRAZO',
          situacaoEstorno: estorno,
          orderId: 'ORD-LEGITIMA',
          aprovadoEm: '2026-11-15T11:00:00.000Z',
        });
      },
    );

    it('pagamento confirmado depois do prazo não é PAGO_NO_PRAZO', async () => {
      const { servico, mensagens } = montar(SituacaoCobranca.ESTORNADA, {
        aprovadoEm: new Date('2100-01-01T00:00:00.000Z'),
      });

      await servico.executar('op1');

      expect(mensagens[0].envelope.payload.situacaoPagamento).toBe(
        'SEM_PAGAMENTO',
      );
    });

    it('sem order legítima ou sem horário de aprovação responde INDETERMINADA sem cancelar', async () => {
      const semOrder = montar(SituacaoCobranca.PENDENCIA_MANUAL, {
        legitima: null,
      });
      await semOrder.servico.executar('op1');
      const semHorario = montar(SituacaoCobranca.PENDENCIA_MANUAL, {
        aprovadoEm: null,
      });
      await semHorario.servico.executar('op1');

      for (const { mensagens, cancelarOrder } of [semOrder, semHorario]) {
        expect(mensagens[0].envelope.payload.situacaoPagamento).toBe(
          'INDETERMINADA',
        );
        expect(cancelarOrder).not.toHaveBeenCalled();
      }
    });

    it('consulta da order legítima indeterminada não conclui a operação', async () => {
      const { servico, mensagens, consultarOrder } = montar(
        SituacaoCobranca.ESTORNADA,
      );
      consultarOrder.mockResolvedValue({
        tipo: 'indeterminado',
        motivo: 'timeout',
      } as never);

      await servico.executar('op1');

      expect(mensagens).toHaveLength(0);
    });
  });
});
