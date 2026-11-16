import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { Orcamento } from '../../domain/entities/orcamento.entity';
import {
  AprovacaoEncerradaError,
  EstadoIncompativelAprovacaoError,
} from '../../domain/errors/orcamento.errors';
import { SituacaoOrcamento } from '../../domain/situacao-orcamento';
import { AplicarResultadoReservaService } from './aplicar-resultado-reserva.service';

const item = {
  tipo: 'SERVICO' as const,
  itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  nome: 'Serviço',
  quantidade: 1,
  precoUnitarioCentavos: 1000,
};

describe('AplicarResultadoReservaService', () => {
  const uow = new UnitOfWorkFake();
  let orcamento: Orcamento;
  const orcamentos = {
    buscarPorId: jest.fn(),
    atualizar: jest.fn(async (_ctx, _id, o) => o),
    liberarBloqueioAprovacao: jest.fn(),
  };
  const cobrancas = { criar: jest.fn(async (_ctx, c) => c) };
  const service = new AplicarResultadoReservaService(
    uow,
    orcamentos,
    cobrancas,
    2,
  );

  beforeEach(() => {
    orcamento = new Orcamento({
      id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
      rodada: 1,
      clienteId: '7c9e6679-7425-40de-944b-e07fc1f90ae8',
      correlationId: '8c9e6679-7425-40de-944b-e07fc1f90ae9',
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [item],
    });
    jest.clearAllMocks();
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
  });

  it('retorna 202 em resultado indeterminado', async () => {
    const resultado = await service.aplicar(orcamento, {
      tipo: 'indeterminado',
      motivo: 'timeout',
    });
    expect(resultado.statusHttp).toBe(202);
    expect(orcamentos.liberarBloqueioAprovacao).toHaveBeenCalled();
  });

  it('indeterminado sem liberar bloqueio quando reprocessamento', async () => {
    const resultado = await service.aplicar(
      orcamento,
      { tipo: 'indeterminado', motivo: 'timeout' },
      { liberarBloqueioEmIndeterminado: false },
    );
    expect(resultado.statusHttp).toBe(202);
    expect(orcamentos.liberarBloqueioAprovacao).not.toHaveBeenCalled();
  });

  it('volta a GERADO em ESTADO_INCOMPATIVEL', async () => {
    await expect(
      service.aplicar(orcamento, {
        tipo: 'conflito',
        codigo: 'ESTADO_INCOMPATIVEL',
        mensagem: 'aguarde',
      }),
    ).rejects.toBeInstanceOf(EstadoIncompativelAprovacaoError);
  });

  it('falha em CONTEUDO_DIVERGENTE', async () => {
    await expect(
      service.aplicar(orcamento, {
        tipo: 'conflito',
        codigo: 'CONTEUDO_DIVERGENTE',
        mensagem: 'divergente',
      }),
    ).rejects.toThrow('Conflito de reserva não tratado');
  });

  it('encerra aprovação em RODADA_OBSOLETA', async () => {
    await expect(
      service.aplicar(orcamento, {
        tipo: 'conflito',
        codigo: 'RODADA_OBSOLETA',
        mensagem: 'rodada',
      }),
    ).rejects.toBeInstanceOf(AprovacaoEncerradaError);
  });

  it('retorna 200 em conflito obsoleto já aprovado', async () => {
    const aprovado = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVADO,
      tentativaAprovacao: 2,
      itens: [item],
    });
    orcamentos.buscarPorId.mockResolvedValue(aprovado);
    const baseAntigo = new Orcamento({
      ...aprovado,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [item],
    });
    const resultado = await service.aplicar(baseAntigo, {
      tipo: 'conflito',
      codigo: 'ESTOQUE_INSUFICIENTE',
      mensagem: 'atrasado',
    });
    expect(resultado.statusHttp).toBe(200);
  });

  it('não propaga conflito obsoleto', async () => {
    orcamento = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.GERADO,
      tentativaAprovacao: 2,
      itens: [item],
    });
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    const baseAntigo = new Orcamento({
      ...orcamento,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [item],
    });
    const resultado = await service.aplicar(baseAntigo, {
      tipo: 'conflito',
      codigo: 'ESTOQUE_INSUFICIENTE',
      mensagem: 'sem estoque',
    });
    expect(resultado.statusHttp).toBe(202);
  });

  it('ignora resposta atrasada de tentativa anterior', async () => {
    orcamento = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.GERADO,
      tentativaAprovacao: 2,
      itens: [item],
    });
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    const baseAntigo = new Orcamento({
      ...orcamento,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [item],
    });

    const resultado = await service.aplicar(baseAntigo, {
      tipo: 'sucesso',
      reservaId: 'reserva-antiga',
      prazoReferencia: new Date('2026-11-15T12:00:00.000Z'),
    });
    expect(resultado.statusHttp).toBe(202);
    expect(cobrancas.criar).not.toHaveBeenCalled();
  });

  it('encerra aprovação em OS_EM_CANCELAMENTO', async () => {
    await expect(
      service.aplicar(orcamento, {
        tipo: 'conflito',
        codigo: 'OS_EM_CANCELAMENTO',
        mensagem: 'cancelando',
      }),
    ).rejects.toBeInstanceOf(AprovacaoEncerradaError);
  });
});
