import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProcessarNotificacaoMercadoPagoUseCase } from '@/modules/cobrancas/application/use-cases/processar-notificacao-mercado-pago.use-case';
import { gerarAssinaturaWebhook } from '@/shared/testing/gerar-assinatura-webhook';
import { AssinaturaWebhookInvalidaError } from './errors/assinatura-webhook-invalida.error';
import { ValidarAssinaturaWebhookService } from './validar-assinatura-webhook.service';
import { WebhookMercadoPagoController } from './webhook-mercado-pago.controller';

describe('WebhookMercadoPagoController', () => {
  const validar = new ValidarAssinaturaWebhookService();
  const processar = {
    execute: jest.fn().mockResolvedValue({
      cobrancaId: 'cobranca-1',
      situacao: 'PENDENTE',
      efeitoAplicado: false,
    }),
  } as unknown as ProcessarNotificacaoMercadoPagoUseCase;

  const config = {
    get: (chave: string) => {
      if (chave === 'MP_WEBHOOK_SECRET') {
        return 'segredo-unit';
      }
      return undefined;
    },
  } as ConfigService;

  const controller = new WebhookMercadoPagoController(
    validar,
    processar,
    config,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejeita quando o segredo não está configurado', async () => {
    const semSegredo = new WebhookMercadoPagoController(validar, processar, {
      get: () => undefined,
    } as ConfigService);

    await expect(
      semSegredo.receber(
        { data: { id: 'ORD1' } },
        'ORD1',
        'order',
        'ts=1,v1=x',
        'req',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejeita quando não há order id', async () => {
    await expect(
      controller.receber(
        { extra_mp: true },
        undefined,
        'order',
        'ts=1,v1=x',
        'req',
      ),
    ).rejects.toBeInstanceOf(AssinaturaWebhookInvalidaError);
  });

  it('rejeita assinatura inválida', async () => {
    await expect(
      controller.receber(
        { data: { id: 'ORD1' } },
        'ORD1',
        'order',
        'ts=1,v1=invalida',
        'req',
      ),
    ).rejects.toBeInstanceOf(AssinaturaWebhookInvalidaError);
  });

  it('aceita assinatura válida e delega conciliação', async () => {
    const orderId = 'ORDTST01UNIT0001';
    const requestId = 'req-valido';
    const assinatura = gerarAssinaturaWebhook(
      orderId,
      requestId,
      'segredo-unit',
    );

    const resposta = await controller.receber(
      { type: 'order', action: 'order.updated', data: { id: orderId } },
      orderId,
      'order',
      assinatura,
      requestId,
    );

    expect(processar.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mercadoPagoOrderId: orderId }),
    );
    expect(resposta.recebido).toBe(true);
    expect(resposta.cobrancaId).toBe('cobranca-1');
  });
});
