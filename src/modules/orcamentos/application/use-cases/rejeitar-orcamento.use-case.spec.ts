import { EVENTO_ORCAMENTO_REJEITADO } from '@/shared/messaging/envelope';
import { OrcamentoNaoEncontradoError } from '../../domain/errors/orcamento.errors';
import { RejeitarOrcamentoUseCase } from './rejeitar-orcamento.use-case';
import {
  criarGatewayOrcamentoMock,
  criarOrcamentoFake,
  criarOutboxMock,
  unitOfWorkFake,
} from './test-doubles';

describe('RejeitarOrcamentoUseCase', () => {
  let gateway: ReturnType<typeof criarGatewayOrcamentoMock>;
  let outbox: ReturnType<typeof criarOutboxMock>;
  let useCase: RejeitarOrcamentoUseCase;

  beforeEach(() => {
    gateway = criarGatewayOrcamentoMock();
    outbox = criarOutboxMock();
    useCase = new RejeitarOrcamentoUseCase(unitOfWorkFake, gateway, outbox);
  });

  it('falha quando orçamento não existe', async () => {
    gateway.buscarPorId.mockResolvedValue(null);

    await expect(
      useCase.execute('inexistente', { motivo: 'Não quero' }),
    ).rejects.toThrow(OrcamentoNaoEncontradoError);
  });

  it('rejeita e publica OrcamentoRejeitado na outbox', async () => {
    const orcamento = criarOrcamentoFake();
    gateway.buscarPorId.mockResolvedValue(orcamento);
    gateway.atualizar.mockImplementation(async (_ctx, _id, ent) => ent);

    const saida = await useCase.execute(orcamento.id as string, {
      motivo: 'Caro demais',
    });

    expect(saida.situacao).toBe('REJEITADO');
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_ORCAMENTO_REJEITADO }),
    );
  });
});
