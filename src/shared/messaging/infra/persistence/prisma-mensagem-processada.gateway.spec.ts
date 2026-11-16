import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaMensagemProcessadaGateway } from './prisma-mensagem-processada.gateway';

describe('PrismaMensagemProcessadaGateway', () => {
  const cliente = {
    mensagemProcessada: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = { mensagemProcessada: cliente.mensagemProcessada };
  const gateway = new PrismaMensagemProcessadaGateway(prisma as never);
  const contexto = new PrismaContextoTransacao(cliente as never);

  beforeEach(() => jest.clearAllMocks());

  it('indica quando eventId já foi processado', async () => {
    cliente.mensagemProcessada.findUnique.mockResolvedValue({ eventId: 'e1' });
    await expect(gateway.jaProcessada(contexto, 'e1')).resolves.toBe(true);
  });

  it('registra eventId processado', async () => {
    await gateway.registrar(contexto, 'e1', 'hash');
    expect(cliente.mensagemProcessada.create).toHaveBeenCalled();
  });
});