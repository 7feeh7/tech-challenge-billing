import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTO_ORCAMENTO_GERADO } from '@/shared/messaging/envelope';
import { hashEnvelope } from '@/shared/messaging/hash-envelope';
import { ProcessarGerarOrcamentoUseCase } from './processar-gerar-orcamento.use-case';
import {
  criarGatewayOrcamentoMock,
  criarMensagemProcessadaMock,
  criarOrcamentoFake,
  criarOutboxMock,
  unitOfWorkFake,
} from './test-doubles';

describe('ProcessarGerarOrcamentoUseCase', () => {
  const exemplo = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'docs/contratos/exemplos/billing.gerar-orcamento.v1.json',
      ),
      'utf-8',
    ),
  );

  let gateway: ReturnType<typeof criarGatewayOrcamentoMock>;
  let mensagens: ReturnType<typeof criarMensagemProcessadaMock>;
  let outbox: ReturnType<typeof criarOutboxMock>;
  let useCase: ProcessarGerarOrcamentoUseCase;

  beforeEach(() => {
    gateway = criarGatewayOrcamentoMock();
    mensagens = criarMensagemProcessadaMock();
    outbox = criarOutboxMock();
    useCase = new ProcessarGerarOrcamentoUseCase(
      unitOfWorkFake,
      gateway,
      mensagens,
      outbox,
    );
  });

  it('ignora eventType diferente de GerarOrcamento', async () => {
    await useCase.processar({ ...exemplo, eventType: 'billing.outro.v1' });
    expect(gateway.criar).not.toHaveBeenCalled();
  });

  it('cria orçamento, outbox de gerado e marca mensagem processada', async () => {
    mensagens.jaProcessada.mockResolvedValue(false);
    gateway.buscarPorOrdemServicoERodada.mockResolvedValue(null);
    gateway.criar.mockResolvedValue(criarOrcamentoFake());

    await useCase.processar(exemplo);

    expect(gateway.criar).toHaveBeenCalledTimes(1);
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_ORCAMENTO_GERADO }),
    );
    expect(mensagens.registrar).toHaveBeenCalled();
  });

  it('mensagem repetida não cria segundo orçamento', async () => {
    mensagens.jaProcessada.mockResolvedValue(true);
    mensagens.buscarHash.mockResolvedValue(hashEnvelope(exemplo));

    await useCase.processar(exemplo);

    expect(gateway.criar).not.toHaveBeenCalled();
  });

  it('falha quando eventId repetido com hash divergente', async () => {
    mensagens.jaProcessada.mockResolvedValue(true);
    mensagens.buscarHash.mockResolvedValue('outro-hash');

    await expect(useCase.processar(exemplo)).rejects.toThrow(
      'conteúdo divergente',
    );
  });

  it('não duplica orçamento quando OS e rodada já existem', async () => {
    mensagens.jaProcessada.mockResolvedValue(false);
    gateway.buscarPorOrdemServicoERodada.mockResolvedValue(
      criarOrcamentoFake(),
    );

    await useCase.processar(exemplo);

    expect(gateway.criar).not.toHaveBeenCalled();
    expect(mensagens.registrar).toHaveBeenCalled();
  });
});
