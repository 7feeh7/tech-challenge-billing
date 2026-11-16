import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  OrderMercadoPagoGateway,
  OrderMercadoPagoRegistro,
} from '../../application/ports/order-mercado-pago.gateway';

@Injectable()
export class PrismaOrderMercadoPagoGateway implements OrderMercadoPagoGateway {
  constructor(private readonly prisma: PrismaService) {}

  async buscarAtivaPorCobrancaId(
    cobrancaId: string,
  ): Promise<OrderMercadoPagoRegistro | null> {
    const raw = await this.prisma.orderMercadoPago.findFirst({
      where: { cobrancaId, ativa: true },
      orderBy: { criadoEm: 'desc' },
    });
    if (!raw) return null;
    return this.toRegistro(raw);
  }

  async criar(
    contexto: ContextoTransacao,
    registro: OrderMercadoPagoRegistro,
  ): Promise<OrderMercadoPagoRegistro> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.orderMercadoPago.create({
      data: {
        cobrancaId: registro.cobrancaId,
        mercadoPagoOrderId: registro.mercadoPagoOrderId,
        chaveIdempotencia: registro.chaveIdempotencia,
        checkoutUrl: registro.checkoutUrl,
        statusOrder: registro.statusOrder ?? null,
        statusDetail: registro.statusDetail ?? null,
        ativa: registro.ativa,
      },
    });
    return this.toRegistro(raw);
  }

  async atualizarSituacao(
    contexto: ContextoTransacao,
    id: string,
    statusOrder: string | null,
    statusDetail: string | null,
  ): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.orderMercadoPago.update({
      where: { id },
      data: { statusOrder, statusDetail },
    });
  }

  async desativar(contexto: ContextoTransacao, id: string): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.orderMercadoPago.update({
      where: { id },
      data: { ativa: false },
    });
  }

  private toRegistro(raw: {
    id: string;
    cobrancaId: string;
    mercadoPagoOrderId: string;
    chaveIdempotencia: string;
    checkoutUrl: string;
    statusOrder: string | null;
    statusDetail: string | null;
    ativa: boolean;
  }): OrderMercadoPagoRegistro {
    return {
      id: raw.id,
      cobrancaId: raw.cobrancaId,
      mercadoPagoOrderId: raw.mercadoPagoOrderId,
      chaveIdempotencia: raw.chaveIdempotencia,
      checkoutUrl: raw.checkoutUrl,
      statusOrder: raw.statusOrder,
      statusDetail: raw.statusDetail,
      ativa: raw.ativa,
    };
  }
}
