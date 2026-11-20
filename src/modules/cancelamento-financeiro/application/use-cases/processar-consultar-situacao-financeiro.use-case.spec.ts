import { ConteudoMensagemDivergenteError } from '@/modules/orcamentos/domain/errors/orcamento.errors';
import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { Prisma } from '@/shared/generated/prisma/client';
import { EVENTO_CONSULTAR_SITUACAO_FINANCEIRA } from '@/shared/messaging/envelope';
import { hashEnvelope } from '@/shared/messaging/hash-envelope';
import { ProcessarConsultarSituacaoFinanceiroUseCase } from './processar-consultar-situacao-financeiro.use-case';

describe('ProcessarConsultarSituacaoFinanceiroUseCase', () => {
  const envelope = {
    eventId: '550e8400-e29b-41d4-a716-446655440099',
    eventType: EVENTO_CONSULTAR_SITUACAO_FINANCEIRA,
    version: 1,
    occurredAt: '2026-11-16T12:00:00.000Z',
    source: 'os-service',
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    causationId: null,
    ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
    rodada: 1,
    payload: {
      consultaId: 'f7e1d5c4-9a6b-7c2d-1e4f-5a8b0c3d6e9f',
      finalidade: 'EXCECAO_E10' as const,
    },
  };

  it('não duplica operação para o mesmo consultaId', async () => {
    const operacoes = {
      buscarPorEventId: jest.fn().mockResolvedValue(null),
      buscarPorConsultaId: jest.fn().mockResolvedValue({ id: 'existente' }),
      criarConsulta: jest.fn(),
    };
    const mensagens = {
      jaProcessada: jest.fn().mockResolvedValue(false),
      registrar: jest.fn(),
      buscarHash: jest.fn(),
    };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      mensagens as never,
    );
    await caso.processar(envelope);
    expect(operacoes.criarConsulta).not.toHaveBeenCalled();
    expect(mensagens.registrar).toHaveBeenCalled();
  });

  it('ignora tipo de evento diferente', async () => {
    const operacoes = { criarConsulta: jest.fn() };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      {} as never,
    );
    await caso.processar({ ...envelope, eventType: 'billing.outro.v1' });
    expect(operacoes.criarConsulta).not.toHaveBeenCalled();
  });

  it('falha quando eventId já processado com hash divergente', async () => {
    const operacoes = {
      buscarPorEventId: jest.fn().mockResolvedValue(null),
      buscarPorConsultaId: jest.fn(),
      criarConsulta: jest.fn(),
    };
    const mensagens = {
      jaProcessada: jest.fn().mockResolvedValue(true),
      buscarHash: jest.fn().mockResolvedValue('hash-antigo'),
      registrar: jest.fn(),
    };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      mensagens as never,
    );
    await expect(caso.processar(envelope)).rejects.toBeInstanceOf(
      ConteudoMensagemDivergenteError,
    );
  });

  it('recupera após violação de unicidade quando operação já existe', async () => {
    const operacoes = {
      buscarPorEventId: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'op1' }),
      buscarPorConsultaId: jest.fn(),
      criarConsulta: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    };
    const mensagens = {
      jaProcessada: jest.fn().mockResolvedValue(false),
      registrar: jest.fn(),
      buscarHash: jest.fn(),
    };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      mensagens as never,
    );
    await caso.processar(envelope);
    expect(mensagens.registrar).toHaveBeenCalled();
  });

  it('ignora reentrega idempotente com mesmo hash', async () => {
    const operacoes = {
      buscarPorEventId: jest.fn(),
      buscarPorConsultaId: jest.fn(),
      criarConsulta: jest.fn(),
    };
    const mensagens = {
      jaProcessada: jest.fn().mockResolvedValue(true),
      buscarHash: jest.fn().mockResolvedValue(hashEnvelope(envelope)),
      registrar: jest.fn(),
    };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      mensagens as never,
    );
    await caso.processar(envelope);
    expect(operacoes.criarConsulta).not.toHaveBeenCalled();
  });

  it('registra mensagem quando operação já existe por eventId', async () => {
    const operacoes = {
      buscarPorEventId: jest.fn().mockResolvedValue({ id: 'op1' }),
      buscarPorConsultaId: jest.fn(),
      criarConsulta: jest.fn(),
    };
    const mensagens = {
      jaProcessada: jest.fn().mockResolvedValue(false),
      registrar: jest.fn(),
      buscarHash: jest.fn(),
    };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      mensagens as never,
    );
    await caso.processar(envelope);
    expect(operacoes.criarConsulta).not.toHaveBeenCalled();
    expect(mensagens.registrar).toHaveBeenCalled();
  });

  it('propaga erro quando concorrência não deixa operação persistida', async () => {
    const operacoes = {
      buscarPorEventId: jest.fn().mockResolvedValue(null),
      buscarPorConsultaId: jest.fn().mockResolvedValue(null),
      criarConsulta: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    };
    const mensagens = {
      jaProcessada: jest.fn().mockResolvedValue(false),
      registrar: jest.fn(),
      buscarHash: jest.fn(),
    };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      mensagens as never,
    );
    await expect(caso.processar(envelope)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('cria operação de consulta na primeira entrega', async () => {
    const operacoes = {
      buscarPorEventId: jest.fn().mockResolvedValue(null),
      buscarPorConsultaId: jest.fn().mockResolvedValue(null),
      criarConsulta: jest.fn().mockResolvedValue({ id: 'op1' }),
    };
    const mensagens = {
      jaProcessada: jest.fn().mockResolvedValue(false),
      registrar: jest.fn(),
      buscarHash: jest.fn(),
    };
    const caso = new ProcessarConsultarSituacaoFinanceiroUseCase(
      new UnitOfWorkFake(),
      operacoes as never,
      mensagens as never,
    );
    await caso.processar(envelope);
    expect(operacoes.criarConsulta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        consultaId: envelope.payload.consultaId,
        finalidade: 'EXCECAO_E10',
      }),
    );
  });
});
