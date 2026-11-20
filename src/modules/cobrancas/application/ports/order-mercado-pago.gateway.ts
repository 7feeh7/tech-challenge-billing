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
  confirmouPagamento?: boolean;
}

export interface OrderMercadoPagoGateway {
  buscarAtivaPorCobrancaId(
    cobrancaId: string,
  ): Promise<OrderMercadoPagoRegistro | null>;
  buscarUltimaPorCobrancaId(
    cobrancaId: string,
  ): Promise<OrderMercadoPagoRegistro | null>;
  buscarPorMercadoPagoOrderId(
    mercadoPagoOrderId: string,
  ): Promise<OrderMercadoPagoRegistro | null>;
  /**
   * Order que confirmou o pagamento da cobrança. Para cobranças pagas antes do
   * registro persistente, recai na order ativa e, por fim, na mais recente.
   */
  buscarQueConfirmouPagamento(
    cobrancaId: string,
  ): Promise<OrderMercadoPagoRegistro | null>;
  marcarConfirmouPagamento(
    contexto: ContextoTransacao,
    id: string,
  ): Promise<void>;
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
