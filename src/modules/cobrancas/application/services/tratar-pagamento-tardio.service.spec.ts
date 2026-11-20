import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import { TratarPagamentoTardioService } from './tratar-pagamento-tardio.service';

describe('TratarPagamentoTardioService', () => {
  const cobranca = new Cobranca({
    id: 'c1',
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    rodada: 1,
    clienteId: 'cl1',
    correlationId: 'corr',
    valorTotalCentavos: 1000,
    prazoPagamento: new Date('2020-01-01T00:00:00.000Z'),
    situacao: SituacaoCobranca.PENDENTE,
  });

  const aprovadoEm = new Date('2020-02-01T00:00:00.000Z');

  function criarServico(
    opcoes: {
      cobranca?: Cobranca | null;
      estorno?: { id: string; situacao: string };
      criado?: boolean;
    } = {},
  ) {
    const cobrancas = {
      buscarPorId: jest
        .fn()
        .mockResolvedValue(
          opcoes.cobranca === undefined ? cobranca : opcoes.cobranca,
        ),
      atualizar: jest.fn(),
      atualizarSePosse: jest.fn(),
    };
    const estornos = {
      registrarSeNovo: jest.fn().mockResolvedValue({
        estorno: opcoes.estorno ?? { id: 'e1', situacao: 'EM_ANDAMENTO' },
        criado: opcoes.criado ?? true,
      }),
    };
    const executarEstorno = { executar: jest.fn() };
    const servico = new TratarPagamentoTardioService(
      new UnitOfWorkFake(),
      cobrancas as never,
      estornos as never,
      executarEstorno as never,
    );
    return { servico, cobrancas, estornos, executarEstorno };
  }

  it('ignora quando cobrança não existe', async () => {
    const { servico, estornos, executarEstorno } = criarServico({
      cobranca: null,
    });
    await servico.tratar({
      cobrancaId: 'x',
      posseAte: null,
      orderId: 'loc',
      aprovadoEm,
    });
    expect(estornos.registrarSeNovo).not.toHaveBeenCalled();
    expect(executarEstorno.executar).not.toHaveBeenCalled();
  });

  it('identifica pagamento após prazo', () => {
    const { servico } = criarServico();
    expect(servico.deveTratarPagamentoTardio(cobranca, aprovadoEm)).toBe(true);
  });

  it('deve tratar pagamento tardio em cobrança já expirada', () => {
    const { servico } = criarServico();
    const expirada = new Cobranca({
      ...cobranca,
      situacao: SituacaoCobranca.EXPIRADA,
    });
    expect(
      servico.deveTratarPagamentoTardio(
        expirada,
        new Date('2020-01-01T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('trata como tardio o pagamento de cobrança que nunca chegou a pendente', () => {
    const { servico } = criarServico();
    const intencao = new Cobranca({
      ...cobranca,
      situacao: SituacaoCobranca.INTENCAO,
    });
    expect(
      servico.deveTratarPagamentoTardio(
        intencao,
        new Date('2019-12-31T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('não trata como tardio o pagamento dentro do prazo de cobrança pendente', () => {
    const { servico } = criarServico();
    expect(
      servico.deveTratarPagamentoTardio(
        cobranca,
        new Date('2019-12-31T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('registra o estorno do pagamento tardio e o executa', async () => {
    const { servico, estornos, executarEstorno } = criarServico();

    await servico.tratar({
      cobrancaId: 'c1',
      posseAte: null,
      orderId: 'loc',
      aprovadoEm,
    });

    expect(estornos.registrarSeNovo).toHaveBeenCalledWith(expect.anything(), {
      cobrancaId: 'c1',
      orderMercadoPagoId: 'loc',
      tipo: 'PAGAMENTO_TARDIO',
      valorCentavos: 1000,
      aprovadoEm,
    });
    expect(executarEstorno.executar).toHaveBeenCalledWith('e1');
  });

  it('libera a posse da conciliação ao registrar o estorno', async () => {
    const { servico, cobrancas } = criarServico();
    const posseAte = new Date('2099-01-01T00:00:00.000Z');

    await servico.tratar({
      cobrancaId: 'c1',
      posseAte,
      orderId: 'loc',
      aprovadoEm,
    });

    expect(cobrancas.atualizarSePosse).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      expect.objectContaining({ bloqueadoConciliacaoAte: null }),
      posseAte,
    );
  });

  it('libera o bloqueio sem posse pela atualização simples', async () => {
    const { servico, cobrancas } = criarServico();

    await servico.tratar({
      cobrancaId: 'c1',
      posseAte: null,
      orderId: 'loc',
      aprovadoEm,
    });

    expect(cobrancas.atualizar).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      expect.objectContaining({ bloqueadoConciliacaoAte: null }),
    );
  });

  it('retoma o estorno já registrado que continua em andamento', async () => {
    const { servico, executarEstorno } = criarServico({
      criado: false,
      estorno: { id: 'e1', situacao: 'EM_ANDAMENTO' },
    });

    await servico.tratar({
      cobrancaId: 'c1',
      posseAte: null,
      orderId: 'loc',
      aprovadoEm,
    });

    expect(executarEstorno.executar).toHaveBeenCalledWith('e1');
  });

  it.each(['CONCLUIDO', 'PENDENCIA_MANUAL'])(
    'não executa de novo o estorno registrado em %s',
    async (situacao) => {
      const { servico, executarEstorno } = criarServico({
        criado: false,
        estorno: { id: 'e1', situacao },
      });

      await servico.tratar({
        cobrancaId: 'c1',
        posseAte: null,
        orderId: 'loc',
        aprovadoEm,
      });

      expect(executarEstorno.executar).not.toHaveBeenCalled();
    },
  );
});
