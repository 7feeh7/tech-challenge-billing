import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { EVENTO_PAGAMENTO_CONFIRMADO } from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { OrderMercadoPagoRegistro } from '../ports/order-mercado-pago.gateway';
import { RegistrarSegundoPagamentoService } from './registrar-segundo-pagamento.service';

const aprovadoEm = new Date('2026-11-15T12:00:00.000Z');

function criarCobranca(situacao: SituacaoCobranca): Cobranca {
  return new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 2,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 1000,
    prazoPagamento: new Date('2099-01-01T00:00:00.000Z'),
    situacao,
  });
}

const orderLegitima: OrderMercadoPagoRegistro = {
  id: 'omp1',
  cobrancaId: 'c1',
  mercadoPagoOrderId: 'ORD1',
  chaveIdempotencia: 'k1',
  checkoutUrl: 'url',
  ativa: false,
  confirmouPagamento: true,
};

const orderSegunda: OrderMercadoPagoRegistro = {
  id: 'omp2',
  cobrancaId: 'c1',
  mercadoPagoOrderId: 'ORD2',
  chaveIdempotencia: 'k2',
  checkoutUrl: 'url2',
  ativa: false,
};

function montar(
  opcoes: {
    confirmadora?: OrderMercadoPagoRegistro | null;
    registro?: { criado: boolean; situacao: string };
  } = {},
) {
  const estornos = {
    registrarSeNovo: jest.fn().mockResolvedValue({
      estorno: {
        id: 'e1',
        situacao: opcoes.registro?.situacao ?? 'EM_ANDAMENTO',
      },
      criado: opcoes.registro?.criado ?? true,
    }),
  };
  const orders = {
    buscarQueConfirmouPagamento: jest
      .fn()
      .mockResolvedValue(
        opcoes.confirmadora === undefined ? orderLegitima : opcoes.confirmadora,
      ),
    desativar: jest.fn(),
  };
  const outbox = { registrar: jest.fn() };
  const executarEstorno = { executar: jest.fn() };
  const servico = new RegistrarSegundoPagamentoService(
    estornos as never,
    orders as never,
    outbox as never,
    executarEstorno as never,
  );
  return { servico, estornos, orders, outbox, executarEstorno };
}

describe('RegistrarSegundoPagamentoService', () => {
  describe('orderEhSegundoPagamento', () => {
    it.each([
      SituacaoCobranca.PAGA,
      SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
      SituacaoCobranca.ESTORNADA,
      SituacaoCobranca.PENDENCIA_MANUAL,
    ])(
      'é segundo pagamento a order diferente da legítima com cobrança %s',
      async (situacao) => {
        const { servico } = montar();

        await expect(
          servico.orderEhSegundoPagamento(
            criarCobranca(situacao),
            orderSegunda,
          ),
        ).resolves.toBe(true);
      },
    );

    it('não é segundo pagamento a própria order que confirmou o pagamento', async () => {
      const { servico } = montar();

      await expect(
        servico.orderEhSegundoPagamento(
          criarCobranca(SituacaoCobranca.PAGA),
          orderLegitima,
        ),
      ).resolves.toBe(false);
    });

    it.each([
      SituacaoCobranca.INTENCAO,
      SituacaoCobranca.PENDENTE,
      SituacaoCobranca.EXPIRADA,
      SituacaoCobranca.CANCELADA,
    ])(
      'não é segundo pagamento com cobrança %s, ainda sem pagamento confirmado',
      async (situacao) => {
        const { servico, orders } = montar();

        await expect(
          servico.orderEhSegundoPagamento(
            criarCobranca(situacao),
            orderSegunda,
          ),
        ).resolves.toBe(false);
        expect(orders.buscarQueConfirmouPagamento).not.toHaveBeenCalled();
      },
    );

    it('não é segundo pagamento quando a cobrança não tem identificador', async () => {
      const { servico } = montar();
      const semId = new Cobranca({
        ...criarCobranca(SituacaoCobranca.PAGA),
        id: undefined,
        situacao: SituacaoCobranca.PAGA,
      });

      await expect(
        servico.orderEhSegundoPagamento(semId, orderSegunda),
      ).resolves.toBe(false);
    });
  });

  describe('registrar', () => {
    it('registra o estorno da segunda order e publica PagamentoConfirmado na mesma transação', async () => {
      const { servico, estornos, orders, outbox } = montar();

      const estornoId = await servico.registrar({} as never, {
        cobranca: criarCobranca(SituacaoCobranca.PAGA),
        order: orderSegunda,
        aprovadoEm,
      });

      expect(estornoId).toBe('e1');
      expect(estornos.registrarSeNovo).toHaveBeenCalledWith(expect.anything(), {
        cobrancaId: 'c1',
        orderMercadoPagoId: 'omp2',
        tipo: 'SEGUNDO_PAGAMENTO',
        valorCentavos: 1000,
        aprovadoEm,
      });
      expect(orders.desativar).toHaveBeenCalledWith(expect.anything(), 'omp2');
      const [, mensagem] = outbox.registrar.mock.calls[0];
      expect(mensagem.eventType).toBe(EVENTO_PAGAMENTO_CONFIRMADO);
      expect(mensagem.envelope).toMatchObject({
        ordemServicoId: 'os1',
        rodada: 2,
        correlationId: 'corr',
        payload: {
          cobrancaId: 'c1',
          orderId: 'ORD2',
          aprovadoEm: aprovadoEm.toISOString(),
          valorCentavos: 1000,
          origemPagamento: 'SEGUNDO_PAGAMENTO',
        },
      });
    });

    it('não publica de novo quando a order já estava registrada e devolve o estorno ainda aberto', async () => {
      const { servico, outbox, orders } = montar({
        registro: { criado: false, situacao: 'EM_ANDAMENTO' },
      });

      const estornoId = await servico.registrar({} as never, {
        cobranca: criarCobranca(SituacaoCobranca.PAGA),
        order: orderSegunda,
        aprovadoEm,
      });

      expect(estornoId).toBe('e1');
      expect(outbox.registrar).not.toHaveBeenCalled();
      expect(orders.desativar).not.toHaveBeenCalled();
    });

    it.each(['CONCLUIDO', 'PENDENCIA_MANUAL'])(
      'não devolve estorno a executar quando o registro já está %s',
      async (situacao) => {
        const { servico, outbox } = montar({
          registro: { criado: false, situacao },
        });

        const estornoId = await servico.registrar({} as never, {
          cobranca: criarCobranca(SituacaoCobranca.PAGA),
          order: orderSegunda,
          aprovadoEm,
        });

        expect(estornoId).toBeNull();
        expect(outbox.registrar).not.toHaveBeenCalled();
      },
    );

    it('não registra nada quando a order não tem identificador local', async () => {
      const { servico, estornos } = montar();

      const estornoId = await servico.registrar({} as never, {
        cobranca: criarCobranca(SituacaoCobranca.PAGA),
        order: { ...orderSegunda, id: undefined },
        aprovadoEm,
      });

      expect(estornoId).toBeNull();
      expect(estornos.registrarSeNovo).not.toHaveBeenCalled();
    });

    it('registra dentro da unidade de trabalho recebida', async () => {
      const { servico, estornos } = montar();
      const unitOfWork = new UnitOfWorkFake();

      await unitOfWork.executar((ctx) =>
        servico.registrar(ctx, {
          cobranca: criarCobranca(SituacaoCobranca.PAGA),
          order: orderSegunda,
          aprovadoEm,
        }),
      );

      expect(estornos.registrarSeNovo).toHaveBeenCalledTimes(1);
    });
  });

  describe('iniciarEstorno', () => {
    it('delega a execução do estorno', async () => {
      const { servico, executarEstorno } = montar();

      await servico.iniciarEstorno('e1');

      expect(executarEstorno.executar).toHaveBeenCalledWith('e1');
    });
  });
});
