import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import { ListarCobrancasUseCase } from './listar-cobrancas.use-case';

describe('ListarCobrancasUseCase', () => {
  it('lista cobranças paginadas', async () => {
    const cobranca = new Cobranca({
      id: 'c1',
      orcamentoId: 'o1',
      ordemServicoId: 'os1',
      rodada: 1,
      clienteId: 'cl',
      correlationId: 'corr',
      valorTotalCentavos: 100,
      prazoPagamento: new Date(),
      situacao: SituacaoCobranca.PENDENTE,
    });

    const gateway: CobrancaGateway = {
      listar: jest.fn().mockResolvedValue({ itens: [cobranca], total: 1 }),
    } as unknown as CobrancaGateway;

    const caso = new ListarCobrancasUseCase(gateway);
    const resultado = await caso.execute(1, 10, {});
    expect(resultado.total).toBe(1);
    expect(resultado.itens[0]?.id).toBe('c1');
  });
});
