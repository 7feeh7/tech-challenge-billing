import { Module } from '@nestjs/common';
import { ConsultarOrderMercadoPagoService } from './consultar-order-mercado-pago.service';
import { RegistroEntregaWebhookProvaService } from './registro-entrega-webhook-prova.service';
import { RegistroNotificacaoWebhookService } from './registro-notificacao-webhook.service';
import { ValidarAssinaturaWebhookService } from './validar-assinatura-webhook.service';
import { WebhookMercadoPagoController } from './webhook-mercado-pago.controller';

@Module({
  controllers: [WebhookMercadoPagoController],
  providers: [
    ValidarAssinaturaWebhookService,
    RegistroNotificacaoWebhookService,
    ConsultarOrderMercadoPagoService,
    RegistroEntregaWebhookProvaService,
  ],
  exports: [ValidarAssinaturaWebhookService],
})
export class WebhookMercadoPagoModule {}
