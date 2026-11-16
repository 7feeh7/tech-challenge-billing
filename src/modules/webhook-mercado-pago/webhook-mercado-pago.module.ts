import { Module } from '@nestjs/common';
import { CobrancasModule } from '@/modules/cobrancas/cobrancas.module';
import { ValidarAssinaturaWebhookService } from './validar-assinatura-webhook.service';
import { WebhookMercadoPagoController } from './webhook-mercado-pago.controller';

@Module({
  imports: [CobrancasModule],
  controllers: [WebhookMercadoPagoController],
  providers: [ValidarAssinaturaWebhookService],
  exports: [ValidarAssinaturaWebhookService],
})
export class WebhookMercadoPagoModule {}
