import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsultarOrderMercadoPagoService } from './consultar-order-mercado-pago.service';
import { AssinaturaWebhookInvalidaError } from './errors/assinatura-webhook-invalida.error';
import { RegistroEntregaWebhookProvaService } from './registro-entrega-webhook-prova.service';
import { RegistroNotificacaoWebhookService } from './registro-notificacao-webhook.service';
import { ValidarAssinaturaWebhookService } from './validar-assinatura-webhook.service';
import { WebhookMercadoPagoController } from './webhook-mercado-pago.controller';

describe('WebhookMercadoPagoController', () => {
  const validar = new ValidarAssinaturaWebhookService();
  const registro = new RegistroNotificacaoWebhookService();
  const consultar = new ConsultarOrderMercadoPagoService({
    get: () => undefined,
  } as ConfigService);

  const config = {
    get: (chave: string) => {
      if (chave === 'MP_WEBHOOK_SECRET') {
        return 'segredo-unit';
      }
      if (chave === 'MP_WEBHOOK_PROVA_HABILITADA') {
        return 'true';
      }
      return undefined;
    },
  } as ConfigService;

  const registroArquivo = {
    registrar: jest.fn(),
  } as unknown as RegistroEntregaWebhookProvaService;

  const controller = new WebhookMercadoPagoController(
    validar,
    registro,
    consultar,
    registroArquivo,
    config,
  );

  beforeEach(() => {
    registro.limpar();
  });

  it('rejeita quando o segredo não está configurado', async () => {
    const semSegredo = new WebhookMercadoPagoController(
      validar,
      registro,
      consultar,
      registroArquivo,
      { get: () => undefined } as ConfigService,
    );

    await expect(
      semSegredo.receber(
        { data: { id: 'ORD1' } },
        'ORD1',
        'order',
        'ts=1,v1=x',
        'req',
        undefined,
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
        undefined,
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
        undefined,
      ),
    ).rejects.toBeInstanceOf(AssinaturaWebhookInvalidaError);
  });

  it('simula falha quando prova_simular_falha está ativa', async () => {
    const orderId = 'ORDTST01UNIT0002';
    const requestId = 'req-falha';
    const assinatura = validar.gerarAssinaturaParaProva(
      orderId,
      requestId,
      'segredo-unit',
    );

    await expect(
      controller.receber(
        { type: 'order', data: { id: orderId } },
        orderId,
        'order',
        assinatura,
        requestId,
        '1',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('aceita assinatura válida e marca duplicata no reenvio', async () => {
    const orderId = 'ORDTST01UNIT0001';
    const requestId = 'req-valido';
    const assinatura = validar.gerarAssinaturaParaProva(
      orderId,
      requestId,
      'segredo-unit',
    );

    const primeira = await controller.receber(
      { type: 'order', data: { id: orderId } },
      orderId,
      'order',
      assinatura,
      requestId,
      undefined,
    );
    const segunda = await controller.receber(
      { type: 'order', data: { id: orderId } },
      orderId,
      'order',
      assinatura,
      requestId,
      undefined,
    );

    expect(primeira.duplicado).toBe(false);
    expect(segunda.duplicado).toBe(true);
  });
});
