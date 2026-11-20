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

export interface CancelarOrderMercadoPagoSucesso {
  tipo: 'sucesso';
  status?: string;
  statusDetail?: string;
}

export interface CancelarOrderMercadoPagoConflito {
  tipo: 'conflito_especifico';
  codigo: string;
}

export interface CancelarOrderMercadoPagoIndeterminado {
  tipo: 'indeterminado';
  motivo: string;
}

export type ResultadoCancelarOrderMercadoPago =
  | CancelarOrderMercadoPagoSucesso
  | CancelarOrderMercadoPagoConflito
  | CancelarOrderMercadoPagoIndeterminado;

export interface EstornarTotalMercadoPagoSucesso {
  tipo: 'sucesso';
  status?: string;
}

export interface EstornarTotalMercadoPagoConflito {
  tipo: 'conflito_especifico';
  codigo: string;
}

export interface EstornarTotalMercadoPagoIndeterminado {
  tipo: 'indeterminado';
  motivo: string;
}

export type ResultadoEstornarTotalMercadoPago =
  | EstornarTotalMercadoPagoSucesso
  | EstornarTotalMercadoPagoConflito
  | EstornarTotalMercadoPagoIndeterminado;

export interface MercadoPagoGateway {
  criarOrder(
    input: CriarOrderMercadoPagoInput,
  ): Promise<ResultadoCriarOrderMercadoPago>;
  consultarOrder(orderId: string): Promise<ResultadoConsultarOrderMercadoPago>;
  cancelarOrder(
    orderId: string,
    idempotencyKey: string,
  ): Promise<ResultadoCancelarOrderMercadoPago>;
  estornarTotal(
    orderId: string,
    idempotencyKey: string,
  ): Promise<ResultadoEstornarTotalMercadoPago>;
}
