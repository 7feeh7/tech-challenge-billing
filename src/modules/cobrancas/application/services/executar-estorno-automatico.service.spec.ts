import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import {
  EVENTO_ESTORNO_CONCLUIDO,
  EVENTO_PAGAMENTO_TARDIO_REGISTRADO,
} from '@/shared/messaging/envelope';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { EstornoAutomaticoRegistro } from '../ports/estorno-automatico.gateway';
import { ExecutarEstornoAutomaticoService } from './executar-estorno-automatico.service';

const ORDER_MP = 'ORDTST01SEGUNDO';

const orderEstornada = {
  tipo: 'sucesso' as const,
  order: { id: ORDER_MP, status: 'refunded', pagamentos: [] },
};
const orderPaga = {
  tipo: 'sucesso' as const,
  order: { id: ORDER_MP, status: 'processed', pagamentos: [] },
};
const orderParcial = {
  tipo: 'sucesso' as const,
  order: {
    id: ORDER_MP,
    status: 'partially_refunded',
    refundedAmount: 400,
    pagamentos: [],
  },
};
const consultaIndeterminada = {
  tipo: 'indeterminado' as const,
  motivo: 'timeout',
};

function criarEstorno(
  sobrescrever: Partial<EstornoAutomaticoRegistro> = {},
): EstornoAutomaticoRegistro {
  return {
    id: 'e1',
    cobrancaId: 'c1',
    orderMercadoPagoId: 'omp2',
    mercadoPagoOrderId: ORDER_MP,
    tipo: 'SEGUNDO_PAGAMENTO',
    situacao: 'EM_ANDAMENTO',
    chaveIdempotencia: 'chave-estorno',
    valorCentavos: 1000,
    aprovadoEm: new Date('2026-11-15T12:00:00.000Z'),
    tentativas: 0,
    pendenciaId: null,
    ...sobrescrever,
  };
}

function criarCobranca(situacao: SituacaoCobranca): Cobranca {
  return new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 1000,
    prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
    situacao,
  });
}

function montar(
  opcoes: {
    estorno?: EstornoAutomaticoRegistro;
    cobranca?: Cobranca | null;
    consultas?: unknown[];
    estornarTotal?: unknown;
    tentativasAposIncremento?: number;
    estornoBloqueado?: EstornoAutomaticoRegistro | null;
    reivindicado?: boolean;
  } = {},
) {
  const estorno = opcoes.estorno ?? criarEstorno();
  const cobranca =
    opcoes.cobranca === undefined
      ? criarCobranca(SituacaoCobranca.PAGA)
      : opcoes.cobranca;
  const consultar = jest.fn();
  for (const consulta of opcoes.consultas ?? []) {
    consultar.mockResolvedValueOnce(consulta);
  }
  const mercadoPago = {
    consultarOrder: consultar,
    estornarTotal: jest
      .fn()
      .mockResolvedValue(opcoes.estornarTotal ?? { tipo: 'sucesso' }),
  };
  const estornos = {
    reivindicar: jest
      .fn()
      .mockResolvedValue(opcoes.reivindicado === false ? null : estorno),
    bloquearEmAndamento: jest
      .fn()
      .mockResolvedValue(
        opcoes.estornoBloqueado === undefined
          ? estorno
          : opcoes.estornoBloqueado,
      ),
    incrementarTentativas: jest
      .fn()
      .mockResolvedValue(opcoes.tentativasAposIncremento ?? 1),
    adiar: jest.fn(),
    concluir: jest.fn(),
    abrirPendenciaManual: jest.fn(),
  };
  const cobrancas = {
    bloquearParaAtualizacao: jest.fn().mockResolvedValue(cobranca),
    atualizar: jest.fn(),
  };
  const orders = { desativar: jest.fn(), atualizarSituacao: jest.fn() };
  const pendencias = {
    criar: jest.fn().mockResolvedValue({ id: 'pend1' }),
  };
  const outbox = { registrar: jest.fn() };
  const servico = new ExecutarEstornoAutomaticoService(
    new UnitOfWorkFake(),
    estornos as never,
    cobrancas as never,
    orders as never,
    pendencias as never,
    mercadoPago as never,
    outbox as never,
    { maxTentativas: 3, atrasoRetryMs: 30_000, posseMs: 60_000 },
  );
  return {
    servico,
    estorno,
    mercadoPago,
    estornos,
    cobrancas,
    orders,
    pendencias,
    outbox,
  };
}

function publicados(outbox: { registrar: jest.Mock }, eventType: string) {
  return outbox.registrar.mock.calls
    .map(([, mensagem]) => mensagem)
    .filter((mensagem) => mensagem.eventType === eventType);
}

describe('ExecutarEstornoAutomaticoService', () => {
  describe('executar', () => {
    it('não processa quando outra instância detém a posse do estorno', async () => {
      const { servico, mercadoPago } = montar({ reivindicado: false });

      await servico.executar('e1');

      expect(mercadoPago.consultarOrder).not.toHaveBeenCalled();
    });

    it('reivindica o estorno com a posse configurada', async () => {
      const { servico, estornos } = montar({
        consultas: [orderEstornada],
      });

      await servico.executar('e1');

      expect(estornos.reivindicar).toHaveBeenCalledWith('e1', 60_000);
    });
  });

  describe('segundo pagamento', () => {
    it('publica EstornoConcluido integral só depois de confirmar o estorno na consulta', async () => {
      const { servico, estorno, mercadoPago, outbox, estornos, orders } =
        montar({ consultas: [orderPaga, orderEstornada] });

      await servico.processar(estorno);

      expect(mercadoPago.estornarTotal).toHaveBeenCalledWith(
        ORDER_MP,
        'chave-estorno',
      );
      const [mensagem] = publicados(outbox, EVENTO_ESTORNO_CONCLUIDO);
      expect(mensagem.envelope.payload).toEqual({
        cobrancaId: 'c1',
        orderId: ORDER_MP,
        valorEstornadoCentavos: 1000,
        estornadoEm: expect.any(String),
        tipoEstorno: 'INTEGRAL',
        statusOrderMercadoPago: 'refunded',
        origemEstorno: 'SEGUNDO_PAGAMENTO',
      });
      expect(mensagem.envelope.ordemServicoId).toBe('os1');
      expect(estornos.concluir).toHaveBeenCalledWith(expect.anything(), 'e1');
      expect(orders.desativar).toHaveBeenCalledWith(expect.anything(), 'omp2');
    });

    it('conclui sem repetir o pedido quando a order já está estornada', async () => {
      const { servico, estorno, mercadoPago, outbox } = montar({
        consultas: [orderEstornada],
      });

      await servico.processar(estorno);

      expect(mercadoPago.estornarTotal).not.toHaveBeenCalled();
      expect(publicados(outbox, EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(1);
    });

    it('não altera a situação da cobrança legítima ao concluir', async () => {
      const { servico, estorno, cobrancas } = montar({
        consultas: [orderEstornada],
      });

      await servico.processar(estorno);

      expect(cobrancas.atualizar).not.toHaveBeenCalled();
    });

    it('nunca publica PagamentoTardioRegistrado para segundo pagamento', async () => {
      const { servico, estorno, outbox } = montar({
        consultas: [orderEstornada],
      });

      await servico.processar(estorno);

      expect(
        publicados(outbox, EVENTO_PAGAMENTO_TARDIO_REGISTRADO),
      ).toHaveLength(0);
    });

    it('com estorno parcial não publica conclusão e agenda nova tentativa com a mesma chave', async () => {
      const { servico, estorno, mercadoPago, outbox, estornos } = montar({
        consultas: [orderPaga, orderParcial],
      });

      await servico.processar(estorno);

      expect(outbox.registrar).not.toHaveBeenCalled();
      expect(estornos.incrementarTentativas).toHaveBeenCalledWith('e1');
      expect(estornos.adiar).toHaveBeenCalledWith('e1', expect.any(Date));
      expect(mercadoPago.estornarTotal).toHaveBeenCalledWith(
        ORDER_MP,
        'chave-estorno',
      );
    });

    it('com resultado do pedido indeterminado e consulta sem estorno agenda nova tentativa', async () => {
      const { servico, estorno, outbox, estornos } = montar({
        consultas: [orderPaga, orderPaga],
        estornarTotal: { tipo: 'indeterminado', motivo: 'timeout' },
      });

      await servico.processar(estorno);

      expect(outbox.registrar).not.toHaveBeenCalled();
      expect(estornos.adiar).toHaveBeenCalled();
    });

    it('com pedido recusado por conflito e consulta sem estorno não conclui', async () => {
      const { servico, estorno, outbox, estornos } = montar({
        consultas: [orderPaga, orderPaga],
        estornarTotal: { tipo: 'conflito_especifico', codigo: 'x' },
      });

      await servico.processar(estorno);

      expect(outbox.registrar).not.toHaveBeenCalled();
      expect(estornos.adiar).toHaveBeenCalled();
    });

    it('conclui quando o pedido deu conflito mas a consulta prova o estorno integral', async () => {
      const { servico, estorno, outbox } = montar({
        consultas: [orderPaga, orderEstornada],
        estornarTotal: {
          tipo: 'conflito_especifico',
          codigo: 'order_already_refunded',
        },
      });

      await servico.processar(estorno);

      expect(publicados(outbox, EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(1);
    });

    it('com a consulta inicial indeterminada não repete o pedido e conta a tentativa', async () => {
      const { servico, estorno, mercadoPago, estornos } = montar({
        consultas: [consultaIndeterminada],
      });

      await servico.processar(estorno);

      expect(mercadoPago.estornarTotal).not.toHaveBeenCalled();
      expect(estornos.incrementarTentativas).toHaveBeenCalled();
      expect(estornos.adiar).toHaveBeenCalled();
    });

    it('com a consulta de confirmação indeterminada não publica e conta a tentativa', async () => {
      const { servico, estorno, outbox, estornos } = montar({
        consultas: [orderPaga, consultaIndeterminada],
      });

      await servico.processar(estorno);

      expect(outbox.registrar).not.toHaveBeenCalled();
      expect(estornos.incrementarTentativas).toHaveBeenCalled();
    });

    it('esgotadas as tentativas abre pendência manual, sem EstornoConcluido, e emite os sinais', async () => {
      const { servico, estorno, outbox, estornos, pendencias } = montar({
        consultas: [orderPaga, orderPaga],
        tentativasAposIncremento: 3,
        estornoBloqueado: criarEstorno({ tentativas: 3 }),
      });
      const avisos = jest
        .spyOn(
          (servico as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await servico.processar(estorno);

      expect(pendencias.criar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          cobrancaId: 'c1',
          ordemServicoId: 'os1',
          rodada: 1,
          valorCobrancaCentavos: 1000,
        }),
      );
      expect(estornos.abrirPendenciaManual).toHaveBeenCalledWith(
        expect.anything(),
        'e1',
        'pend1',
      );
      expect(estornos.adiar).not.toHaveBeenCalled();
      expect(outbox.registrar).not.toHaveBeenCalled();
      const metricas = avisos.mock.calls.map(
        ([mensagem]) => JSON.parse(mensagem as string).metric,
      );
      expect(metricas).toEqual([
        'billing.operacao_financeira_indeterminada',
        'billing.pendencia_estorno_aberta',
      ]);
    });

    it('não conclui quando o estorno já não está em andamento ao bloquear', async () => {
      const { servico, estorno, outbox, estornos } = montar({
        consultas: [orderEstornada],
        estornoBloqueado: null,
      });

      await servico.processar(estorno);

      expect(estornos.concluir).not.toHaveBeenCalled();
      expect(outbox.registrar).not.toHaveBeenCalled();
    });

    it('não abre pendência quando o estorno já não está em andamento ao bloquear', async () => {
      const { servico, estorno, pendencias } = montar({
        consultas: [orderPaga, orderPaga],
        tentativasAposIncremento: 3,
        estornoBloqueado: null,
      });

      await servico.processar(estorno);

      expect(pendencias.criar).not.toHaveBeenCalled();
    });

    it('não conclui quando a cobrança deixou de existir', async () => {
      const { servico, estorno, estornos } = montar({
        consultas: [orderEstornada],
        cobranca: null,
      });

      await servico.processar(estorno);

      expect(estornos.concluir).not.toHaveBeenCalled();
    });

    it('não abre pendência quando a cobrança deixou de existir', async () => {
      const { servico, estorno, pendencias } = montar({
        consultas: [orderPaga, orderPaga],
        tentativasAposIncremento: 3,
        cobranca: null,
      });

      await servico.processar(estorno);

      expect(pendencias.criar).not.toHaveBeenCalled();
    });
  });

  describe('pagamento tardio', () => {
    const tardio = () => criarEstorno({ tipo: 'PAGAMENTO_TARDIO' });

    it('publica ESTORNO_AUTOMATICO só com estorno integral confirmado e expira a cobrança pendente', async () => {
      const { servico, outbox, cobrancas } = montar({
        estorno: tardio(),
        cobranca: criarCobranca(SituacaoCobranca.PENDENTE),
        consultas: [orderPaga, orderEstornada],
      });

      await servico.processar(tardio());

      const [mensagem] = publicados(outbox, EVENTO_PAGAMENTO_TARDIO_REGISTRADO);
      expect(mensagem.envelope.payload).toEqual({
        cobrancaId: 'c1',
        orderId: ORDER_MP,
        aprovadoEm: '2026-11-15T12:00:00.000Z',
        tratamento: 'ESTORNO_AUTOMATICO',
      });
      expect(cobrancas.atualizar).toHaveBeenCalledWith(
        expect.anything(),
        'c1',
        expect.objectContaining({ situacao: SituacaoCobranca.EXPIRADA }),
      );
      expect(publicados(outbox, EVENTO_ESTORNO_CONCLUIDO)).toHaveLength(0);
    });

    it('publica direto quando a order já está estornada, sem repetir o pedido', async () => {
      const { servico, mercadoPago, outbox } = montar({
        estorno: tardio(),
        consultas: [orderEstornada],
      });

      await servico.processar(tardio());

      expect(mercadoPago.estornarTotal).not.toHaveBeenCalled();
      expect(
        publicados(outbox, EVENTO_PAGAMENTO_TARDIO_REGISTRADO),
      ).toHaveLength(1);
    });

    it.each([
      ['parcial', orderParcial],
      ['indeterminado', consultaIndeterminada],
    ])('com estorno %s não publica ESTORNO_AUTOMATICO', async (_, consulta) => {
      const { servico, outbox, estornos } = montar({
        estorno: tardio(),
        consultas: [orderPaga, consulta],
      });

      await servico.processar(tardio());

      expect(outbox.registrar).not.toHaveBeenCalled();
      expect(estornos.adiar).toHaveBeenCalled();
    });

    it('não altera a cobrança já expirada ao concluir', async () => {
      const { servico, cobrancas } = montar({
        estorno: tardio(),
        cobranca: criarCobranca(SituacaoCobranca.EXPIRADA),
        consultas: [orderEstornada],
      });

      await servico.processar(tardio());

      expect(cobrancas.atualizar).not.toHaveBeenCalled();
    });

    it('esgotadas as tentativas publica PENDENCIA_MANUAL e expira a cobrança pendente', async () => {
      const { servico, outbox, estornos, cobrancas } = montar({
        estorno: tardio(),
        cobranca: criarCobranca(SituacaoCobranca.PENDENTE),
        consultas: [orderPaga, orderParcial],
        tentativasAposIncremento: 3,
        estornoBloqueado: criarEstorno({
          tipo: 'PAGAMENTO_TARDIO',
          tentativas: 3,
        }),
      });
      jest
        .spyOn(
          (servico as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await servico.processar(tardio());

      const [mensagem] = publicados(outbox, EVENTO_PAGAMENTO_TARDIO_REGISTRADO);
      expect(mensagem.envelope.payload.tratamento).toBe('PENDENCIA_MANUAL');
      expect(estornos.abrirPendenciaManual).toHaveBeenCalled();
      expect(cobrancas.atualizar).toHaveBeenCalledWith(
        expect.anything(),
        'c1',
        expect.objectContaining({ situacao: SituacaoCobranca.EXPIRADA }),
      );
    });
  });

  describe('adiarNovaTentativa', () => {
    it('adia o estorno pelo atraso configurado', async () => {
      const { servico, estornos } = montar();
      const antes = Date.now();

      await servico.adiarNovaTentativa('e1');

      const [id, ate] = estornos.adiar.mock.calls[0];
      expect(id).toBe('e1');
      expect((ate as Date).getTime()).toBeGreaterThanOrEqual(antes + 30_000);
    });
  });
});
