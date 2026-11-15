import { DomainUnauthorizedError } from '@/shared/exceptions/domain.error';

export class AssinaturaWebhookInvalidaError extends DomainUnauthorizedError {
  constructor() {
    super('Assinatura do webhook Mercado Pago inválida ou ausente.');
  }
}
