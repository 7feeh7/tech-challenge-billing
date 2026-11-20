import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export interface TentativaRecusaGateway {
  registrarSeNova(
    contexto: ContextoTransacao,
    params: {
      cobrancaId: string;
      orderMercadoPagoId: string;
      paymentIdMercadoPago: string;
      motivo: string;
    },
  ): Promise<boolean>;
}
