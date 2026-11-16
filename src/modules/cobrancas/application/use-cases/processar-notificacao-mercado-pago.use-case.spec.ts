import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { AvisoWebhookGateway } from '../ports/aviso-webhook.gateway';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { ConciliarCobrancaService } from '../services/conciliar-cobranca.service';
import { ProcessarNotificacaoMercadoPagoUseCase } from './processar-notificacao-mercado-pago.use-case';

describe('ProcessarNotificacaoMercadoPagoUseCase', () => {
  it('registra aviso e concilia pela order', async () => {
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

    const cobrancas: CobrancaGateway = {
      buscarPorMercadoPagoOrderId: jest
        .fn()
        .mockResolvedValueOnce(cobranca)
        .mockResolvedValueOnce({
          ...cobranca,
          situacao: SituacaoCobranca.PAGA,
        }),
    } as unknown as CobrancaGateway;

    const avisos: AvisoWebhookGateway = {
      registrar: jest.fn(),
    };

    const conciliar = {
      conciliarPorMercadoPagoOrderId: jest
        .fn()
        .mockResolvedValue({ ...cobranca, situacao: SituacaoCobranca.PAGA }),
    } as unknown as ConciliarCobrancaService;

    const caso = new ProcessarNotificacaoMercadoPagoUseCase(
      new UnitOfWorkFake(),
      cobrancas,
      avisos,
      conciliar,
    );

    const resultado = await caso.execute({
      mercadoPagoOrderId: 'ORD1',
      requestId: 'req-1',
    });

    expect(avisos.registrar).toHaveBeenCalled();
    expect(resultado.efeitoAplicado).toBe(true);
  });

  it('registra aviso mesmo sem cobrança mapeada', async () => {
    const avisos: AvisoWebhookGateway = { registrar: jest.fn() };
    const conciliar = {
      conciliarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(null),
    } as unknown as ConciliarCobrancaService;

    const caso = new ProcessarNotificacaoMercadoPagoUseCase(
      new UnitOfWorkFake(),
      {
        buscarPorMercadoPagoOrderId: jest.fn().mockResolvedValue(null),
      } as unknown as CobrancaGateway,
      avisos,
      conciliar,
    );

    const resultado = await caso.execute({ mercadoPagoOrderId: 'ORD-X' });
    expect(avisos.registrar).toHaveBeenCalled();
    expect(resultado.efeitoAplicado).toBe(false);
  });
});