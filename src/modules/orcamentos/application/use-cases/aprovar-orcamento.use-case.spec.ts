import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { Orcamento } from '../../domain/entities/orcamento.entity';
import {
  EstoqueInsuficienteAprovacaoError,
  OrcamentoNaoEncontradoError,
  SituacaoOrcamentoInvalidaError,
} from '../../domain/errors/orcamento.errors';
import { SituacaoOrcamento } from '../../domain/situacao-orcamento';
import { AplicarResultadoReservaService } from '../services/aplicar-resultado-reserva.service';
import { AprovarOrcamentoUseCase } from './aprovar-orcamento.use-case';

const baseItem = {
  tipo: 'SERVICO' as const,
  itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  nome: 'Serviço',
  quantidade: 1,
  precoUnitarioCentavos: 1000,
};

describe('AprovarOrcamentoUseCase', () => {
  const uow = new UnitOfWorkFake();
  let orcamento: Orcamento;
  const orcamentos = {
    buscarPorId: jest.fn(),
    atualizar: jest.fn(async (_ctx, _id, o) => o),
    liberarBloqueioAprovacao: jest.fn(),
    adiarBloqueioAprovacao: jest.fn(),
    iniciarAprovacaoSeGerado: jest.fn(),
    reivindicarAprovacoesPendentes: jest.fn(),
  };
  const reservaOs = { reservar: jest.fn() };
  const cobrancas = {
    criar: jest.fn(async (_ctx, c) => c),
    buscarPorOrcamentoId: jest.fn(),
  };
  const bloqueios = { existe: jest.fn().mockResolvedValue(false) };
  const aplicar = new AplicarResultadoReservaService(
    uow,
    orcamentos,
    cobrancas,
    bloqueios,
    2,
  );
  const useCase = new AprovarOrcamentoUseCase(
    uow,
    orcamentos,
    reservaOs,
    aplicar,
  );

  beforeEach(() => {
    orcamento = new Orcamento({
      id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
      rodada: 1,
      clienteId: '7c9e6679-7425-40de-944b-e07fc1f90ae8',
      correlationId: '8c9e6679-7425-40de-944b-e07fc1f90ae9',
      itens: [baseItem],
    });
    jest.clearAllMocks();
    orcamentos.buscarPorId.mockImplementation(async () => orcamento);
    orcamentos.iniciarAprovacaoSeGerado.mockImplementation(
      async (_ctx, _id) => {
        const copia = new Orcamento({
          id: orcamento.id,
          ordemServicoId: orcamento.ordemServicoId,
          rodada: orcamento.rodada,
          clienteId: orcamento.clienteId,
          correlationId: orcamento.correlationId,
          situacao: orcamento.situacao,
          itens: orcamento.itens.map((i) => ({
            tipo: i.tipo,
            itemId: i.itemId,
            nome: i.nome,
            quantidade: i.quantidade,
            precoUnitarioCentavos: i.precoUnitarioCentavos,
          })),
          tentativaAprovacao: orcamento.tentativaAprovacao,
        });
        copia.iniciarAprovacao();
        orcamento = copia;
        return copia;
      },
    );
    orcamentos.atualizar.mockImplementation(async (_ctx, _id, atualizado) => {
      orcamento = atualizado;
      return atualizado;
    });
  });

  it('retorna 200 idempotente quando já aprovado', async () => {
    orcamento = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVADO,
      tentativaAprovacao: 1,
      itens: [baseItem],
    });
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    const resultado = await useCase.execute(orcamento.id as string);
    expect(resultado.statusHttp).toBe(200);
    expect(reservaOs.reservar).not.toHaveBeenCalled();
  });

  it('retorna 202 quando concorrente inicia aprovação antes', async () => {
    orcamentos.iniciarAprovacaoSeGerado.mockResolvedValue(null);
    const concorrente = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [baseItem],
    });
    orcamentos.buscarPorId
      .mockResolvedValueOnce(orcamento)
      .mockResolvedValueOnce(concorrente);

    const resultado = await useCase.execute(orcamento.id as string);
    expect(resultado.statusHttp).toBe(202);
    expect(reservaOs.reservar).not.toHaveBeenCalled();
  });

  it('retorna 200 quando concorrente conclui aprovação antes', async () => {
    orcamentos.iniciarAprovacaoSeGerado.mockResolvedValue(null);
    const aprovado = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVADO,
      tentativaAprovacao: 1,
      itens: [baseItem],
    });
    orcamentos.buscarPorId
      .mockResolvedValueOnce(orcamento)
      .mockResolvedValueOnce(aprovado);

    const resultado = await useCase.execute(orcamento.id as string);
    expect(resultado.statusHttp).toBe(200);
    expect(reservaOs.reservar).not.toHaveBeenCalled();
  });

  it('retorna 202 sem nova reserva quando já está em andamento', async () => {
    orcamento = new Orcamento({
      ...orcamento,
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [baseItem],
    });
    orcamentos.buscarPorId.mockResolvedValue(orcamento);

    const resultado = await useCase.execute(orcamento.id as string);
    expect(resultado.statusHttp).toBe(202);
    expect(reservaOs.reservar).not.toHaveBeenCalled();
  });

  it('propaga 409 de estoque insuficiente e volta para GERADO', async () => {
    reservaOs.reservar.mockResolvedValue({
      tipo: 'conflito',
      codigo: 'ESTOQUE_INSUFICIENTE',
      mensagem: 'sem estoque',
    });

    await expect(
      useCase.execute(orcamento.id as string),
    ).rejects.toBeInstanceOf(EstoqueInsuficienteAprovacaoError);
    expect(orcamentos.atualizar).toHaveBeenCalled();
    const ultima = orcamentos.atualizar.mock.calls.at(-1)?.[2] as Orcamento;
    expect(ultima.situacao).toBe(SituacaoOrcamento.GERADO);
    expect(ultima.tentativaAprovacao).toBe(1);
  });

  it('falha quando orçamento não existe', async () => {
    orcamentos.buscarPorId.mockResolvedValue(null);
    await expect(useCase.execute('x')).rejects.toBeInstanceOf(
      OrcamentoNaoEncontradoError,
    );
  });

  it('falha em situação inválida', async () => {
    orcamento = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.REJEITADO,
      itens: [baseItem],
    });
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    await expect(
      useCase.execute(orcamento.id as string),
    ).rejects.toBeInstanceOf(SituacaoOrcamentoInvalidaError);
  });

  it('adia reprocessamento após conflito sem reivindicação válida', async () => {
    orcamento = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [baseItem],
    });
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    reservaOs.reservar.mockResolvedValue({
      tipo: 'conflito',
      codigo: 'ESTOQUE_INSUFICIENTE',
      mensagem: 'sem estoque',
    });
    orcamento.definirBloqueioAprovacao(new Date(Date.now() + 60_000));
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    await useCase.reprocessarPendente(orcamento.id as string);
    expect(orcamentos.adiarBloqueioAprovacao).toHaveBeenCalled();
  });

  it('não reprocessa com bloqueio expirado', async () => {
    orcamento = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      itens: [baseItem],
    });
    orcamento.definirBloqueioAprovacao(new Date(Date.now() - 60_000));
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    await useCase.reprocessarPendente(orcamento.id as string);
    expect(reservaOs.reservar).not.toHaveBeenCalled();
  });

  it('não reprocessa sem reivindicação válida', async () => {
    orcamento = new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
      bloqueadoAprovacaoAte: null,
      itens: [baseItem],
    });
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    await useCase.reprocessarPendente(orcamento.id as string);
    expect(reservaOs.reservar).not.toHaveBeenCalled();
  });

  it('reprocessa pendente com mesma tentativa', async () => {
    orcamento = new Orcamento({
      ...orcamento,
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 2,
      itens: [baseItem],
    });
    orcamento.definirBloqueioAprovacao(new Date(Date.now() + 60_000));
    orcamentos.buscarPorId.mockResolvedValue(orcamento);
    reservaOs.reservar.mockResolvedValue({
      tipo: 'indeterminado',
      motivo: 'timeout',
    });
    await useCase.reprocessarPendente(orcamento.id as string);
    expect(reservaOs.reservar).toHaveBeenCalledWith(
      expect.objectContaining({ tentativaAprovacao: 2 }),
    );
    expect(orcamentos.adiarBloqueioAprovacao).toHaveBeenCalled();
  });

  it('marca aprovado e cria intenção de cobrança no sucesso', async () => {
    reservaOs.reservar.mockResolvedValue({
      tipo: 'sucesso',
      reservaId: '9c9e6679-7425-40de-944b-e07fc1f90af0',
      prazoReferencia: new Date('2026-11-15T12:05:00.000Z'),
    });

    const resultado = await useCase.execute(orcamento.id as string);
    expect(resultado.statusHttp).toBe(200);
    expect(resultado.orcamento.situacao).toBe(SituacaoOrcamento.APROVADO);
    expect(cobrancas.criar).toHaveBeenCalled();
  });
});
