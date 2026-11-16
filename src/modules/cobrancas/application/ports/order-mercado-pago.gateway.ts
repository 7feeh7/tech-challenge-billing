import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export interface OrderMercadoPagoRegistro {
  id?: string;
  cobrancaId: string;
  mercadoPagoOrderId: string;
  chaveIdempotencia: string;
  checkoutUrl: string;
  statusOrder?: string | null;
  statusDetail?: string | null;
  ativa: boolean;
}

export interface OrderMercadoPagoGateway {
  buscarAtivaPorCobrancaId(
    cobrancaId: string,
  ): Promise<OrderMercadoPagoRegistro | null>;
  criar(
    contexto: ContextoTransacao,
    registro: OrderMercadoPagoRegistro,
  ): Promise<OrderMercadoPagoRegistro>;
  atualizarSituacao(
    contexto: ContextoTransacao,
    id: string,
    statusOrder: string | null,
    statusDetail: string | null,
  ): Promise<void>;
  desativar(contexto: ContextoTransacao, id: string): Promise<void>;
}
