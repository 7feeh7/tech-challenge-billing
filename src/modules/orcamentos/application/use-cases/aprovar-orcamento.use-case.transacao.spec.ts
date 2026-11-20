import { Orcamento } from '../../domain/entities/orcamento.entity';
import { AprovarOrcamentoUseCase } from './aprovar-orcamento.use-case';

const item = {
  tipo: 'SERVICO' as const,
  itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  nome: 'Serviço',
  quantidade: 1,
  precoUnitarioCentavos: 1000,
};

describe('AprovarOrcamentoUseCase — fronteira transacional', () => {
  it('não chama reserva do OS dentro da transação local', async () => {
    const ordemChamadas: string[] = [];
    const orcamento = new Orcamento({
      id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
      rodada: 1,
      clienteId: '7c9e6679-7425-40de-944b-e07fc1f90ae8',
      correlationId: '8c9e6679-7425-40de-944b-e07fc1f90ae9',
      itens: [item],
    });

    const orcamentos = {
      buscarPorId: jest.fn().mockResolvedValue(orcamento),
      iniciarAprovacaoSeGerado: jest.fn(async () => {
        ordemChamadas.push('tx');
        return orcamento;
      }),
      atualizar: jest.fn(),
      liberarBloqueioAprovacao: jest.fn(),
      adiarBloqueioAprovacao: jest.fn(),
      reivindicarAprovacoesPendentes: jest.fn(),
    };
    const reservaOs = {
      reservar: jest.fn(async () => {
        ordemChamadas.push('http');
        return { tipo: 'indeterminado', motivo: 'timeout' } as const;
      }),
    };
    const aplicar = {
      aplicar: jest.fn(async () => ({
        statusHttp: 202 as const,
        orcamento: { id: orcamento.id } as never,
      })),
    };

    const fakeUow = {
      executar: async <T>(trabalho: (ctx: unknown) => Promise<T>) => {
        ordemChamadas.push('uow-inicio');
        const out = await trabalho({});
        ordemChamadas.push('uow-fim');
        return out;
      },
    };

    const useCase = new AprovarOrcamentoUseCase(
      fakeUow as never,
      orcamentos as never,
      reservaOs as never,
      aplicar as never,
    );
    await useCase.execute(orcamento.id as string);

    expect(ordemChamadas).toEqual(['uow-inicio', 'tx', 'uow-fim', 'http']);
    expect(reservaOs.reservar).toHaveBeenCalledTimes(1);
  });
});
