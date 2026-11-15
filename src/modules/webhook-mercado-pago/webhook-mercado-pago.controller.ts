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
import { ConsultarOrderMercadoPagoService } from './consultar-order-mercado-pago.service';
import { AssinaturaWebhookInvalidaError } from './errors/assinatura-webhook-invalida.error';
import { RegistroEntregaWebhookProvaService } from './registro-entrega-webhook-prova.service';
import { RegistroNotificacaoWebhookService } from './registro-notificacao-webhook.service';
import { ValidarAssinaturaWebhookService } from './validar-assinatura-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks/mercado-pago')
export class WebhookMercadoPagoController {
  constructor(
    private readonly validarAssinatura: ValidarAssinaturaWebhookService,
    private readonly registro: RegistroNotificacaoWebhookService,
    private readonly consultarOrder: ConsultarOrderMercadoPagoService,
    private readonly registroArquivo: RegistroEntregaWebhookProvaService,
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
    summary: 'Recebe notificações orders_v2 do Mercado Pago (prova E05)',
  })
  async receber(
    @Body() corpo: Record<string, unknown>,
    @Query('data.id') dataIdQuery: string | undefined,
    @Query('type') tipoQuery: string | undefined,
    @Headers('x-signature') assinatura: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Query('prova_simular_falha') provaSimularFalha: string | undefined,
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

    if (
      provaSimularFalha === '1' &&
      this.config.get<string>('MP_WEBHOOK_PROVA_HABILITADA') === 'true'
    ) {
      throw new ServiceUnavailableException(
        'Falha simulada para teste de reenvio (E05).',
      );
    }

    const registro = this.registro.registrar(
      { requestId: requestId ?? orderId, orderId },
      {
        recebidaEm: new Date().toISOString(),
        requestId: requestId ?? orderId,
        notificacaoId:
          corpo.id !== undefined
            ? String(corpo.id as string | number)
            : undefined,
        orderId,
        tipo:
          tipoQuery ??
          (typeof corpo.type === 'string' ? corpo.type : undefined),
        acao: typeof corpo.action === 'string' ? corpo.action : undefined,
      },
    );

    this.registroArquivo.registrar({
      recebidaEm: registro.recebidaEm,
      orderId,
      requestId: registro.requestId,
      notificacaoId: registro.notificacaoId,
      tipo: registro.tipo,
      acao: registro.acao,
      duplicado: registro.duplicada,
    });

    const consulta = await this.consultarOrder.consultar(orderId);

    return {
      recebido: true,
      duplicado: registro.duplicada,
      requestId: registro.requestId,
      orderId,
      tipo: registro.tipo,
      acao: registro.acao,
      situacaoFinanceira: {
        statusOrder: consulta.status,
        statusDetail: consulta.statusDetail,
        indisponivel: consulta.indisponivel,
      },
    };
  }
}
