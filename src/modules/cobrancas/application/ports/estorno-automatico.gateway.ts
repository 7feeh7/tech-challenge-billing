import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export type TipoEstornoAutomaticoRegistro =
  | 'SEGUNDO_PAGAMENTO'
  | 'PAGAMENTO_TARDIO';

export type SituacaoEstornoAutomaticoRegistro =
  | 'EM_ANDAMENTO'
  | 'CONCLUIDO'
  | 'PENDENCIA_MANUAL';

export interface EstornoAutomaticoRegistro {
  id: string;
  cobrancaId: string;
  orderMercadoPagoId: string;
  mercadoPagoOrderId: string;
  tipo: TipoEstornoAutomaticoRegistro;
  situacao: SituacaoEstornoAutomaticoRegistro;
  chaveIdempotencia: string;
  valorCentavos: number;
  aprovadoEm: Date;
  tentativas: number;
  pendenciaId: string | null;
}

export interface RegistrarEstornoAutomaticoInput {
  cobrancaId: string;
  orderMercadoPagoId: string;
  tipo: TipoEstornoAutomaticoRegistro;
  valorCentavos: number;
  aprovadoEm: Date;
}

export interface ResultadoRegistroEstornoAutomatico {
  estorno: EstornoAutomaticoRegistro;
  criado: boolean;
}

export interface EstornoAutomaticoGateway {
  /** Um registro por order: chamadas repetidas ou concorrentes devolvem o mesmo. */
  registrarSeNovo(
    contexto: ContextoTransacao,
    input: RegistrarEstornoAutomaticoInput,
  ): Promise<ResultadoRegistroEstornoAutomatico>;
  buscarPorId(id: string): Promise<EstornoAutomaticoRegistro | null>;
  buscarPorOrderMercadoPagoId(
    orderMercadoPagoId: string,
  ): Promise<EstornoAutomaticoRegistro | null>;
  buscarPorPendenciaId(
    pendenciaId: string,
  ): Promise<EstornoAutomaticoRegistro | null>;
  /** Toma a posse do estorno só se ele estiver em andamento e fora de espera. */
  reivindicar(
    id: string,
    posseMs: number,
  ): Promise<EstornoAutomaticoRegistro | null>;
  reivindicarEmAndamento(
    limite: number,
    posseMs: number,
  ): Promise<EstornoAutomaticoRegistro[]>;
  /** Relê o estorno ainda em andamento bloqueando a linha (`FOR UPDATE`). */
  bloquearEmAndamento(
    contexto: ContextoTransacao,
    id: string,
  ): Promise<EstornoAutomaticoRegistro | null>;
  incrementarTentativas(id: string): Promise<number>;
  adiar(id: string, ate: Date): Promise<void>;
  concluir(contexto: ContextoTransacao, id: string): Promise<void>;
  abrirPendenciaManual(
    contexto: ContextoTransacao,
    id: string,
    pendenciaId: string,
  ): Promise<void>;
}
