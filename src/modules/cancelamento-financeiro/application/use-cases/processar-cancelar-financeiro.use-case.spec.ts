import { ConteudoMensagemDivergenteError } from '@/modules/orcamentos/domain/errors/orcamento.errors';
import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { Prisma } from '@/shared/generated/prisma/client';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import {
  type EnvelopeMensagem,
  EVENTO_CANCELAR_FINANCEIRO,
  type PayloadCancelarFinanceiro,
} from '@/shared/messaging/envelope';
import { hashEnvelope } from '@/shared/messaging/hash-envelope';
import type { BloqueioCriacaoCobrancaGateway } from '../ports/bloqueio-criacao-cobranca.gateway';
import type { OperacaoFinanceiraGateway } from '../ports/operacao-financeira.gateway';
import { ProcessarCancelarFinanceiroUseCase } from './processar-cancelar-financeiro.use-case';

const envelope: EnvelopeMensagem<PayloadCancelarFinanceiro> = {
  eventId: 'ev-cancel',
  eventType: EVENTO_CANCELAR_FINANCEIRO,
  version: 1,
  occurredAt: new Date().toISOString(),
  source: 'os-service',
  correlationId: 'corr',
  causationId: null,
  ordemServicoId: 'os1',
  rodada: 1,
  payload: {
    etapaOrigem: 'CANCELAMENTO_OS',
    motivo: 'desistência',
    resultadoExecucao: 'REPARO_NAO_INICIADO',
  },
};

describe('ProcessarCancelarFinanceiroUseCase', () => {
  it('grava bloqueio e operação na primeira entrega', async () => {
    const bloqueios: BloqueioCriacaoCobrancaGateway = {
      garantir: jest.fn(),
    } as unknown as BloqueioCriacaoCobrancaGateway;
    const operacoes: OperacaoFinanceiraGateway = {
      buscarPorEventId: jest.fn().mockResolvedValue(null),
      criar: jest.fn(),
    } as unknown as OperacaoFinanceiraGateway;
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: jest.fn().mockResolvedValue(false),
      buscarHash: jest.fn(),
      registrar: jest.fn(),
    } as unknown as MensagemProcessadaGateway;

    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      bloqueios,
      operacoes,
      mensagens,
    );
    await caso.processar(envelope);
    expect(bloqueios.garantir).toHaveBeenCalled();
    expect(operacoes.criar).toHaveBeenCalled();
    expect(mensagens.registrar).toHaveBeenCalled();
  });

  it('ignora tipo de evento diferente', async () => {
    const bloqueios = { garantir: jest.fn() };
    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      bloqueios as never,
      { criar: jest.fn() } as never,
      {
        jaProcessada: jest.fn().mockResolvedValue(false),
        registrar: jest.fn(),
      } as never,
    );
    await caso.processar({ ...envelope, eventType: 'outro.evento' });
    expect(bloqueios.garantir).not.toHaveBeenCalled();
  });

  it('ignora reentrega do mesmo eventId', async () => {
    const operacoes: OperacaoFinanceiraGateway = {
      buscarPorEventId: jest.fn().mockResolvedValue({ id: 'op' }),
      criar: jest.fn(),
    } as unknown as OperacaoFinanceiraGateway;
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: jest.fn().mockResolvedValue(false),
      registrar: jest.fn(),
    } as unknown as MensagemProcessadaGateway;
    const bloqueios: BloqueioCriacaoCobrancaGateway = {
      garantir: jest.fn(),
    } as unknown as BloqueioCriacaoCobrancaGateway;

    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      bloqueios,
      operacoes,
      mensagens,
    );
    await caso.processar(envelope);
    expect(operacoes.criar).not.toHaveBeenCalled();
  });

  it('reentrega com mesmo hash não recria operação', async () => {
    const hash = hashEnvelope(envelope);
    const operacoes: OperacaoFinanceiraGateway = {
      buscarPorEventId: jest.fn(),
      criar: jest.fn(),
    } as unknown as OperacaoFinanceiraGateway;
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: jest.fn().mockResolvedValue(true),
      buscarHash: jest.fn().mockResolvedValue(hash),
      registrar: jest.fn(),
    } as unknown as MensagemProcessadaGateway;

    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      { garantir: jest.fn() } as never,
      operacoes,
      mensagens,
    );
    await caso.processar(envelope);
    expect(operacoes.criar).not.toHaveBeenCalled();
    expect(operacoes.buscarPorEventId).not.toHaveBeenCalled();
  });

  it('rejeita reentrega com hash divergente', async () => {
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: jest.fn().mockResolvedValue(true),
      buscarHash: jest.fn().mockResolvedValue('hash-antigo'),
      registrar: jest.fn(),
    } as unknown as MensagemProcessadaGateway;

    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      { garantir: jest.fn() } as never,
      { criar: jest.fn() } as never,
      mensagens,
    );
    await expect(caso.processar(envelope)).rejects.toBeInstanceOf(
      ConteudoMensagemDivergenteError,
    );
  });

  it('corrida P2002: registra mensagem quando operação já existe', async () => {
    const operacoes: OperacaoFinanceiraGateway = {
      buscarPorEventId: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'op-concorrente' }),
      criar: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique', {
          code: 'P2002',
          clientVersion: '0',
        }),
      ),
    } as unknown as OperacaoFinanceiraGateway;
    const registrar = jest.fn();
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false),
      buscarHash: jest.fn(),
      registrar,
    } as unknown as MensagemProcessadaGateway;

    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      { garantir: jest.fn() } as never,
      operacoes,
      mensagens,
    );
    await caso.processar(envelope);
    expect(operacoes.criar).toHaveBeenCalled();
    expect(registrar).toHaveBeenCalled();
  });

  it('corrida P2002 com mensagem já registrada não duplica', async () => {
    const operacoes: OperacaoFinanceiraGateway = {
      buscarPorEventId: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'op-concorrente' }),
      criar: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique', {
          code: 'P2002',
          clientVersion: '0',
        }),
      ),
    } as unknown as OperacaoFinanceiraGateway;
    const registrar = jest.fn();
    const mensagens: MensagemProcessadaGateway = {
      jaProcessada: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      buscarHash: jest.fn(),
      registrar,
    } as unknown as MensagemProcessadaGateway;

    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      { garantir: jest.fn() } as never,
      operacoes,
      mensagens,
    );
    await caso.processar(envelope);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('corrida P2002 sem operação persistida propaga erro', async () => {
    const erro = new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: '0',
    });
    const operacoes: OperacaoFinanceiraGateway = {
      buscarPorEventId: jest.fn().mockResolvedValue(null),
      criar: jest.fn().mockRejectedValue(erro),
    } as unknown as OperacaoFinanceiraGateway;

    const caso = new ProcessarCancelarFinanceiroUseCase(
      new UnitOfWorkFake(),
      { garantir: jest.fn() } as never,
      operacoes,
      {
        jaProcessada: jest.fn().mockResolvedValue(false),
        registrar: jest.fn(),
      } as never,
    );
    await expect(caso.processar(envelope)).rejects.toBe(erro);
  });
});
