import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { TentativaRecusaGateway } from '../../application/ports/tentativa-recusa.gateway';

@Injectable()
export class PrismaTentativaRecusaGateway implements TentativaRecusaGateway {
  constructor(private readonly prisma: PrismaService) {}

  async registrarSeNova(
    contexto: ContextoTransacao,
    params: {
      cobrancaId: string;
      orderMercadoPagoId: string;
      paymentIdMercadoPago: string;
      motivo: string;
    },
  ): Promise<boolean> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const existente = await cliente.tentativaPagamentoRecusada.findUnique({
      where: {
        cobrancaId_paymentIdMercadoPago: {
          cobrancaId: params.cobrancaId,
          paymentIdMercadoPago: params.paymentIdMercadoPago,
        },
      },
    });
    if (existente) return false;

    await cliente.tentativaPagamentoRecusada.create({
      data: {
        cobrancaId: params.cobrancaId,
        orderMercadoPagoId: params.orderMercadoPagoId,
        paymentIdMercadoPago: params.paymentIdMercadoPago,
        motivo: params.motivo,
      },
    });
    return true;
  }
}
