import { PrismaContextoTransacao } from '@/shared/database/prisma-contexto-transacao';
import { PrismaEstornoAutomaticoGateway } from './prisma-estorno-automatico.gateway';

const linha = {
  id: 'e1',
  cobrancaId: 'c1',
  orderMercadoPagoId: 'omp1',
  tipo: 'SEGUNDO_PAGAMENTO' as const,
  situacao: 'EM_ANDAMENTO' as const,
  chaveIdempotencia: 'chave',
  valorCentavos: 1000,
  aprovadoEm: new Date('2026-11-15T12:00:00.000Z'),
  tentativas: 0,
  pendenciaId: null,
  orderMercadoPago: { mercadoPagoOrderId: 'ORD2' },
};

function criarModeloEstorno() {
  return {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: jest.fn().mockResolvedValue(linha),
    findUnique: jest.fn().mockResolvedValue(linha),
    findFirst: jest.fn().mockResolvedValue(linha),
    findMany: jest.fn().mockResolvedValue([linha]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({ tentativas: 2 }),
  };
}

describe('PrismaEstornoAutomaticoGateway', () => {
  describe('registrarSeNovo', () => {
    const input = {
      cobrancaId: 'c1',
      orderMercadoPagoId: 'omp1',
      tipo: 'SEGUNDO_PAGAMENTO' as const,
      valorCentavos: 1000,
      aprovadoEm: new Date('2026-11-15T12:00:00.000Z'),
    };

    it('registra com chave de idempotência nova e informa que criou', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const cliente = { estornoAutomatico };
      const gateway = new PrismaEstornoAutomaticoGateway({} as never);

      const resultado = await gateway.registrarSeNovo(
        new PrismaContextoTransacao(cliente as never),
        input,
      );

      expect(resultado.criado).toBe(true);
      expect(resultado.estorno).toMatchObject({
        id: 'e1',
        mercadoPagoOrderId: 'ORD2',
        chaveIdempotencia: 'chave',
      });
      const [{ data, skipDuplicates }] =
        estornoAutomatico.createMany.mock.calls[0];
      expect(skipDuplicates).toBe(true);
      expect(data[0]).toMatchObject({
        orderMercadoPagoId: 'omp1',
        tipo: 'SEGUNDO_PAGAMENTO',
        valorCentavos: 1000,
      });
      expect(data[0].chaveIdempotencia).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('devolve o registro existente sem criar quando a order já tem estorno', async () => {
      const estornoAutomatico = criarModeloEstorno();
      estornoAutomatico.createMany.mockResolvedValue({ count: 0 });
      const gateway = new PrismaEstornoAutomaticoGateway({} as never);

      const resultado = await gateway.registrarSeNovo(
        new PrismaContextoTransacao({ estornoAutomatico } as never),
        input,
      );

      expect(resultado.criado).toBe(false);
      expect(resultado.estorno.id).toBe('e1');
    });
  });

  describe('consultas', () => {
    it('busca por id', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(gateway.buscarPorId('e1')).resolves.toMatchObject({
        id: 'e1',
      });
    });

    it('devolve null quando o id não existe', async () => {
      const estornoAutomatico = criarModeloEstorno();
      estornoAutomatico.findUnique.mockResolvedValue(null);
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(gateway.buscarPorId('x')).resolves.toBeNull();
    });

    it('busca por pendência', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(gateway.buscarPorPendenciaId('p1')).resolves.toMatchObject({
        id: 'e1',
      });
      expect(estornoAutomatico.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pendenciaId: 'p1' } }),
      );
    });

    it('devolve null quando nenhuma pendência aponta para estorno automático', async () => {
      const estornoAutomatico = criarModeloEstorno();
      estornoAutomatico.findFirst.mockResolvedValue(null);
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(gateway.buscarPorPendenciaId('p1')).resolves.toBeNull();
    });
  });

  describe('reivindicar', () => {
    it('toma a posse só de estorno em andamento e fora de espera', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      const estorno = await gateway.reivindicar('e1', 60_000);

      expect(estorno?.id).toBe('e1');
      const [{ where }] = estornoAutomatico.updateMany.mock.calls[0];
      expect(where.situacao).toBe('EM_ANDAMENTO');
      expect(where.OR).toHaveLength(2);
    });

    it('devolve null quando outra instância já detém a posse', async () => {
      const estornoAutomatico = criarModeloEstorno();
      estornoAutomatico.updateMany.mockResolvedValue({ count: 0 });
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(gateway.reivindicar('e1', 60_000)).resolves.toBeNull();
      expect(estornoAutomatico.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('reivindicarEmAndamento', () => {
    function criarPrisma(ids: string[]) {
      const estornoAutomatico = criarModeloEstorno();
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
        estornoAutomatico,
      };
      const prisma = {
        $transaction: jest.fn((trabalho) => trabalho(tx)),
      };
      return { prisma, tx, estornoAutomatico };
    }

    it('reivindica o lote com posse e devolve os registros', async () => {
      const { prisma, estornoAutomatico } = criarPrisma(['e1']);
      const gateway = new PrismaEstornoAutomaticoGateway(prisma as never);

      const lote = await gateway.reivindicarEmAndamento(5, 60_000);

      expect(lote).toHaveLength(1);
      expect(estornoAutomatico.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['e1'] } },
          data: { bloqueadoProcessamentoAte: expect.any(Date) },
        }),
      );
    });

    it('devolve lote vazio sem atualizar quando não há estorno pendente', async () => {
      const { prisma, estornoAutomatico } = criarPrisma([]);
      const gateway = new PrismaEstornoAutomaticoGateway(prisma as never);

      await expect(gateway.reivindicarEmAndamento(5, 60_000)).resolves.toEqual(
        [],
      );
      expect(estornoAutomatico.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('bloquearEmAndamento', () => {
    it('relê o estorno bloqueando a linha', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const cliente = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'e1' }]),
        estornoAutomatico,
      };
      const gateway = new PrismaEstornoAutomaticoGateway({} as never);

      const estorno = await gateway.bloquearEmAndamento(
        new PrismaContextoTransacao(cliente as never),
        'e1',
      );

      expect(estorno?.id).toBe('e1');
    });

    it('devolve null quando o estorno já não está em andamento', async () => {
      const cliente = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        estornoAutomatico: criarModeloEstorno(),
      };
      const gateway = new PrismaEstornoAutomaticoGateway({} as never);

      await expect(
        gateway.bloquearEmAndamento(
          new PrismaContextoTransacao(cliente as never),
          'e1',
        ),
      ).resolves.toBeNull();
      expect(
        cliente.estornoAutomatico.findUniqueOrThrow,
      ).not.toHaveBeenCalled();
    });
  });

  describe('atualizações', () => {
    it('incrementa as tentativas e devolve o total', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(gateway.incrementarTentativas('e1')).resolves.toBe(2);
      expect(estornoAutomatico.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tentativas: { increment: 1 } },
        }),
      );
    });

    it('adia o processamento', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);
      const ate = new Date('2026-11-16T00:00:00.000Z');

      await gateway.adiar('e1', ate);

      expect(estornoAutomatico.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { bloqueadoProcessamentoAte: ate },
      });
    });

    it('conclui o estorno liberando a posse', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({} as never);

      await gateway.concluir(
        new PrismaContextoTransacao({ estornoAutomatico } as never),
        'e1',
      );

      expect(estornoAutomatico.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { situacao: 'CONCLUIDO', bloqueadoProcessamentoAte: null },
      });
    });

    it('abre a pendência manual ligando o estorno à pendência', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({} as never);

      await gateway.abrirPendenciaManual(
        new PrismaContextoTransacao({ estornoAutomatico } as never),
        'e1',
        'p1',
      );

      expect(estornoAutomatico.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          situacao: 'PENDENCIA_MANUAL',
          pendenciaId: 'p1',
          bloqueadoProcessamentoAte: null,
        },
      });
    });
  });

  describe('buscarPorOrderMercadoPagoId', () => {
    it('busca o estorno pela order local', async () => {
      const estornoAutomatico = criarModeloEstorno();
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(
        gateway.buscarPorOrderMercadoPagoId('omp1'),
      ).resolves.toMatchObject({ id: 'e1', orderMercadoPagoId: 'omp1' });
      expect(estornoAutomatico.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderMercadoPagoId: 'omp1' } }),
      );
    });

    it('devolve null quando a order não tem estorno automático', async () => {
      const estornoAutomatico = criarModeloEstorno();
      estornoAutomatico.findUnique.mockResolvedValue(null);
      const gateway = new PrismaEstornoAutomaticoGateway({
        estornoAutomatico,
      } as never);

      await expect(
        gateway.buscarPorOrderMercadoPagoId('x'),
      ).resolves.toBeNull();
    });
  });
});
