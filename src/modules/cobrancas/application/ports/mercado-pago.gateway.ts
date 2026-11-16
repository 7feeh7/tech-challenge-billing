import type { OrderMercadoPagoConsultada } from '../../domain/interpretar-situacao-order';

export interface CriarOrderMercadoPagoInput {
  externalReference: string;
  totalAmount: string;
  expirationTime: string;
  idempotencyKey: string;
  payerEmail: string;
}

export interface CriarOrderMercadoPagoResultado {
  tipo: 'sucesso';
  orderId: string;
  checkoutUrl: string;
  status?: string;
  statusDetail?: string;
}

export interface CriarOrderMercadoPagoIndeterminado {
  tipo: 'indeterminado';
  motivo: string;
}

export type ResultadoCriarOrderMercadoPago =
  | CriarOrderMercadoPagoResultado
  | CriarOrderMercadoPagoIndeterminado;

export interface ConsultarOrderMercadoPagoResultado {
  tipo: 'sucesso';
  order: OrderMercadoPagoConsultada;
}

export interface ConsultarOrderMercadoPagoIndeterminado {
  tipo: 'indeterminado';
  motivo: string;
}

export type ResultadoConsultarOrderMercadoPago =
  | ConsultarOrderMercadoPagoResultado
  | ConsultarOrderMercadoPagoIndeterminado;

export interface MercadoPagoGateway {
  criarOrder(
    input: CriarOrderMercadoPagoInput,
  ): Promise<ResultadoCriarOrderMercadoPago>;
  consultarOrder(orderId: string): Promise<ResultadoConsultarOrderMercadoPago>;
}
