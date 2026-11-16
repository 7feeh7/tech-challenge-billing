import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  AvisoWebhookGateway,
  AvisoWebhookRegistro,
} from '../../application/ports/aviso-webhook.gateway';

@Injectable()
export class PrismaAvisoWebhookGateway implements AvisoWebhookGateway {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(
    contexto: ContextoTransacao,
    aviso: AvisoWebhookRegistro,
  ): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.avisoWebhookMercadoPago.create({
      data: {
        mercadoPagoOrderId: aviso.mercadoPagoOrderId,
        cobrancaId: aviso.cobrancaId ?? null,
        requestId: aviso.requestId ?? null,
        notificacaoId: aviso.notificacaoId ?? null,
        tipo: aviso.tipo ?? null,
        acao: aviso.acao ?? null,
      },
    });
  }
}
