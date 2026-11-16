import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export interface AvisoWebhookRegistro {
  mercadoPagoOrderId: string;
  cobrancaId?: string | null;
  requestId?: string | null;
  notificacaoId?: string | null;
  tipo?: string | null;
  acao?: string | null;
}

export interface AvisoWebhookGateway {
  registrar(
    contexto: ContextoTransacao,
    aviso: AvisoWebhookRegistro,
  ): Promise<void>;
}
