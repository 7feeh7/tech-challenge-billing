export type CodigoErroReservaOs =
  | 'ESTOQUE_INSUFICIENTE'
  | 'RODADA_OBSOLETA'
  | 'OS_EM_CANCELAMENTO'
  | 'ESTADO_INCOMPATIVEL'
  | 'CONTEUDO_DIVERGENTE';

export interface PedidoReservaOs {
  ordemServicoId: string;
  rodada: number;
  orcamentoId: string;
  tentativaAprovacao: number;
  correlationId: string;
  requestId: string;
}

export type ResultadoReservaOs =
  | {
      tipo: 'sucesso';
      reservaId: string;
      prazoReferencia: Date;
    }
  | {
      tipo: 'conflito';
      codigo: CodigoErroReservaOs;
      mensagem: string;
    }
  | {
      tipo: 'indeterminado';
      motivo: string;
    };

export interface ReservaOsGateway {
  reservar(pedido: PedidoReservaOs): Promise<ResultadoReservaOs>;
}
