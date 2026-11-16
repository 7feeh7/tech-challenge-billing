import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
  ServiceUnavailableException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { ProcessarNotificacaoMercadoPagoUseCase } from '@/modules/cobrancas/application/use-cases/processar-notificacao-mercado-pago.use-case';
import { AssinaturaWebhookInvalidaError } from './errors/assinatura-webhook-invalida.error';
import { ValidarAssinaturaWebhookService } from './validar-assinatura-webhook.service';

@ApiTags('Webhooks')
@Public()
@Controller('webhooks/mercado-pago')
export class WebhookMercadoPagoController {
  constructor(
    private readonly validarAssinatura: ValidarAssinaturaWebhookService,
    private readonly processarNotificacao: ProcessarNotificacaoMercadoPagoUseCase,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: false,
    }),
  )
  @ApiOperation({
    summary: 'Recebe notificações orders_v2 do Mercado Pago',
  })
  async receber(
    @Body() corpo: Record<string, unknown>,
    @Query('data.id') dataIdQuery: string | undefined,
    @Query('type') tipoQuery: string | undefined,
    @Headers('x-signature') assinatura: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
  ) {
    const segredo = this.config.get<string>('MP_WEBHOOK_SECRET')?.trim();
    if (!segredo) {
      throw new ServiceUnavailableException(
        'Webhook indisponível: segredo não configurado.',
      );
    }

    const dataCorpo = corpo.data;
    const orderIdCorpo =
      dataCorpo &&
      typeof dataCorpo === 'object' &&
      'id' in dataCorpo &&
      typeof (dataCorpo as { id?: unknown }).id === 'string'
        ? (dataCorpo as { id: string }).id
        : undefined;
    const orderId = (dataIdQuery ?? orderIdCorpo)?.trim();
    if (!orderId) {
      throw new AssinaturaWebhookInvalidaError();
    }

    const resultadoAssinatura = this.validarAssinatura.validar({
      dataId: orderId,
      requestId,
      assinaturaCabecalho: assinatura,
      segredo,
    });

    if (!resultadoAssinatura.valida) {
      throw new AssinaturaWebhookInvalidaError();
    }

    const resultado = await this.processarNotificacao.execute({
      mercadoPagoOrderId: orderId,
      requestId: requestId ?? undefined,
      notificacaoId:
        corpo.id !== undefined
          ? String(corpo.id as string | number)
          : undefined,
      tipo:
        tipoQuery ?? (typeof corpo.type === 'string' ? corpo.type : undefined),
      acao: typeof corpo.action === 'string' ? corpo.action : undefined,
    });

    return {
      recebido: true,
      orderId,
      requestId: requestId ?? orderId,
      tipo:
        tipoQuery ?? (typeof corpo.type === 'string' ? corpo.type : undefined),
      acao: typeof corpo.action === 'string' ? corpo.action : undefined,
      cobrancaId: resultado.cobrancaId,
      situacaoCobranca: resultado.situacao,
      efeitoAplicado: resultado.efeitoAplicado,
    };
  }
}
