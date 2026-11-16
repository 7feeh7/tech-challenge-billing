import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CriarOrderMercadoPagoInput,
  MercadoPagoGateway,
  ResultadoConsultarOrderMercadoPago,
  ResultadoCriarOrderMercadoPago,
} from '../../application/ports/mercado-pago.gateway';
import type {
  OrderMercadoPagoConsultada,
  PagamentoNaOrder,
} from '../../domain/interpretar-situacao-order';

@Injectable()
export class FetchMercadoPagoGateway implements MercadoPagoGateway {
  constructor(private readonly config: ConfigService) {}

  async criarOrder(
    input: CriarOrderMercadoPagoInput,
  ): Promise<ResultadoCriarOrderMercadoPago> {
    const token = this.config.get<string>('MP_ACCESS_TOKEN')?.trim();
    if (!token) {
      return {
        tipo: 'indeterminado',
        motivo: 'MP_ACCESS_TOKEN não configurado',
      };
    }

    const corpo = {
      type: 'online',
      processing_mode: 'manual',
      total_amount: input.totalAmount,
      external_reference: input.externalReference,
      expiration_time: input.expirationTime,
      payer: { email: input.payerEmail },
      items: [
        {
          title: 'Serviços e peças — oficina',
          unit_price: input.totalAmount,
          quantity: 1,
        },
      ],
    };

    try {
      const resposta = await fetch(`${this.baseUrl()}/v1/orders`, {
        method: 'POST',
        headers: this.cabecalhos(token, input.idempotencyKey, true),
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });

      const parsed = await this.parseJson(resposta);
      if (!resposta.ok) {
        if (resposta.status >= 500 || resposta.status === 408) {
          return {
            tipo: 'indeterminado',
            motivo: `HTTP ${resposta.status}`,
          };
        }
        return {
          tipo: 'indeterminado',
          motivo: `HTTP ${resposta.status}: erro de negócio`,
        };
      }

      const orderId = typeof parsed.id === 'string' ? parsed.id : undefined;
      const checkoutUrl =
        typeof parsed.checkout_url === 'string'
          ? parsed.checkout_url
          : undefined;
      if (!orderId || !checkoutUrl) {
        return {
          tipo: 'indeterminado',
          motivo: 'Resposta sem order id ou checkout_url',
        };
      }

      return {
        tipo: 'sucesso',
        orderId,
        checkoutUrl,
        status: typeof parsed.status === 'string' ? parsed.status : undefined,
        statusDetail:
          typeof parsed.status_detail === 'string'
            ? parsed.status_detail
            : undefined,
      };
    } catch (erro) {
      return {
        tipo: 'indeterminado',
        motivo:
          erro instanceof Error ? erro.message : 'Erro na criação da order',
      };
    }
  }

  async consultarOrder(
    orderId: string,
  ): Promise<ResultadoConsultarOrderMercadoPago> {
    const token = this.config.get<string>('MP_ACCESS_TOKEN')?.trim();
    if (!token) {
      return {
        tipo: 'indeterminado',
        motivo: 'MP_ACCESS_TOKEN não configurado',
      };
    }

    try {
      const resposta = await fetch(`${this.baseUrl()}/v1/orders/${orderId}`, {
        method: 'GET',
        headers: this.cabecalhos(token),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });

      const parsed = await this.parseJson(resposta);
      if (!resposta.ok) {
        return {
          tipo: 'indeterminado',
          motivo: `HTTP ${resposta.status}`,
        };
      }

      return {
        tipo: 'sucesso',
        order: this.mapearOrder(parsed, orderId),
      };
    } catch (erro) {
      return {
        tipo: 'indeterminado',
        motivo:
          erro instanceof Error ? erro.message : 'Erro na consulta da order',
      };
    }
  }

  private mapearOrder(
    corpo: Record<string, unknown>,
    orderId: string,
  ): OrderMercadoPagoConsultada {
    const pagamentos: PagamentoNaOrder[] = [];
    const transacoes = corpo.transactions;
    if (transacoes && typeof transacoes === 'object' && transacoes !== null) {
      const payments = (transacoes as { payments?: unknown }).payments;
      if (Array.isArray(payments)) {
        for (const item of payments) {
          if (item && typeof item === 'object') {
            const p = item as Record<string, unknown>;
            const id = typeof p.id === 'string' ? p.id : undefined;
            const status = typeof p.status === 'string' ? p.status : undefined;
            if (id && status) {
              pagamentos.push({
                id,
                status,
                statusDetail:
                  typeof p.status_detail === 'string'
                    ? p.status_detail
                    : undefined,
                dateApproved:
                  typeof p.date_approved === 'string'
                    ? p.date_approved
                    : undefined,
              });
            }
          }
        }
      }
    }

    return {
      id: typeof corpo.id === 'string' ? corpo.id : orderId,
      status: typeof corpo.status === 'string' ? corpo.status : undefined,
      statusDetail:
        typeof corpo.status_detail === 'string'
          ? corpo.status_detail
          : undefined,
      pagamentos,
    };
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('MP_API_BASE_URL')?.trim() ||
      'https://api.mercadopago.com'
    );
  }

  private timeoutMs(): number {
    return Number(this.config.get<string>('MP_REQUEST_TIMEOUT_MS') ?? '30000');
  }

  private cabecalhos(
    token: string,
    idempotencyKey?: string,
    json = false,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (json) {
      headers['Content-Type'] = 'application/json';
    }
    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey;
    }
    return headers;
  }

  private async parseJson(
    resposta: Response,
  ): Promise<Record<string, unknown>> {
    const texto = await resposta.text();
    try {
      return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
