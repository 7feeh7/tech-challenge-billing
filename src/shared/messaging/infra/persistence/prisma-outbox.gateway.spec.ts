import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaOutboxGateway } from './prisma-outbox.gateway';
import { EVENTO_ORCAMENTO_GERADO } from '../../envelope';

describe('PrismaOutboxGateway', () => {
  it('registra mensagem na outbox', async () => {
    const create = jest.fn();
    const cliente = { mensagemOutbox: { create } };
    const prisma = { mensagemOutbox: { create } };
    const gateway = new PrismaOutboxGateway(prisma as never);
    const contexto = new PrismaContextoTransacao(cliente as never);

    await gateway.registrar(contexto, {
      eventId: 'e1',
      eventType: EVENTO_ORCAMENTO_GERADO,
      correlationId: 'c1',
      destino: 'os-in',
      envelope: {
        eventId: 'e1',
        eventType: EVENTO_ORCAMENTO_GERADO,
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: 'c1',
        causationId: null,
        ordemServicoId: 'os',
        rodada: 1,
        payload: { orcamentoId: 'o1', valorTotalCentavos: 100 },
      },
    });

    expect(create).toHaveBeenCalled();
  });
});