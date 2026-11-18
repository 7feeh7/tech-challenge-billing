import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type MotivoFalhaTecnicaMercadoPago,
  type OperacaoMercadoPago,
  serializarFalhaTecnicaMercadoPago,
} from '@/shared/observability/metrica-log';
import type {
  CriarOrderMercadoPagoInput,
  MercadoPagoGateway,
  ResultadoCancelarOrderMercadoPago,
  ResultadoConsultarOrderMercadoPago,
  ResultadoCriarOrderMercadoPago,
  ResultadoEstornarTotalMercadoPago,
} from '../../application/ports/mercado-pago.gateway';
import type {
  OrderMercadoPagoConsultada,
  PagamentoNaOrder,
} from '../../domain/interpretar-situacao-order';

@Injectable()
export class FetchMercadoPagoGateway implements MercadoPagoGateway {
  private readonly logger = new Logger(FetchMercadoPagoGateway.name);

  constructor(private readonly config: ConfigService) {}

  async criarOrder(
    input: CriarOrderMercadoPagoInput,
  ): Promise<ResultadoCriarOrderMercadoPago> {
    const token = this.config.get<string>('MP_ACCESS_TOKEN')?.trim();
    if (!token) {
      this.registrarFalhaTecnica('criar_order', 'token_ausente');
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
        if (this.ehStatusDeFalhaTecnica(resposta.status)) {
          this.registrarFalhaTecnicaHttp('criar_order', resposta.status);
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
        this.registrarFalhaTecnica('criar_order', 'resposta_invalida');
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
      this.registrarFalhaTecnica('criar_order', this.motivoDoErro(erro));
      return {
        tipo: 'indeterminado',
        motivo:
          erro instanceof Error ? erro.message : 'Erro na criação da order',
      };
    }
  }

  async cancelarOrder(
    orderId: string,
    idempotencyKey: string,
  ): Promise<ResultadoCancelarOrderMercadoPago> {
    return this.postOrderAcao(
      'cancelar_order',
      `/v1/orders/${orderId}/cancel`,
      idempotencyKey,
    ) as Promise<ResultadoCancelarOrderMercadoPago>;
  }

  async estornarTotal(
    orderId: string,
    idempotencyKey: string,
  ): Promise<ResultadoEstornarTotalMercadoPago> {
    return this.postOrderAcao(
      'estornar_total',
      `/v1/orders/${orderId}/refund`,
      idempotencyKey,
    ) as Promise<ResultadoEstornarTotalMercadoPago>;
  }

  async consultarOrder(
    orderId: string,
  ): Promise<ResultadoConsultarOrderMercadoPago> {
    const token = this.config.get<string>('MP_ACCESS_TOKEN')?.trim();
    if (!token) {
      this.registrarFalhaTecnica('consultar_order', 'token_ausente');
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
        if (this.ehStatusDeFalhaTecnica(resposta.status)) {
          this.registrarFalhaTecnicaHttp('consultar_order', resposta.status);
        }
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
      this.registrarFalhaTecnica('consultar_order', this.motivoDoErro(erro));
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

    const refundedAmount = this.extrairRefundedAmountCentavos(corpo);

    return {
      id: typeof corpo.id === 'string' ? corpo.id : orderId,
      status: typeof corpo.status === 'string' ? corpo.status : undefined,
      statusDetail:
        typeof corpo.status_detail === 'string'
          ? corpo.status_detail
          : undefined,
      refundedAmount,
      pagamentos,
    };
  }

  private async postOrderAcao(
    operacao: OperacaoMercadoPago,
    caminho: string,
    idempotencyKey: string,
  ): Promise<
    | { tipo: 'sucesso'; status?: string; statusDetail?: string }
    | { tipo: 'conflito_especifico'; codigo: string }
    | { tipo: 'indeterminado'; motivo: string }
  > {
    const token = this.config.get<string>('MP_ACCESS_TOKEN')?.trim();
    if (!token) {
      this.registrarFalhaTecnica(operacao, 'token_ausente');
      return {
        tipo: 'indeterminado',
        motivo: 'MP_ACCESS_TOKEN não configurado',
      };
    }

    try {
      const resposta = await fetch(`${this.baseUrl()}${caminho}`, {
        method: 'POST',
        headers: this.cabecalhos(token, idempotencyKey, true),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });

      const parsed = await this.parseJson(resposta);
      if (resposta.ok) {
        return {
          tipo: 'sucesso',
          status: typeof parsed.status === 'string' ? parsed.status : undefined,
          statusDetail:
            typeof parsed.status_detail === 'string'
              ? parsed.status_detail
              : undefined,
        };
      }

      if (resposta.status === 409) {
        const codigo = this.extrairCodigoConflito409(parsed);
        if (codigo) {
          return { tipo: 'conflito_especifico', codigo };
        }
        return {
          tipo: 'indeterminado',
          motivo: 'HTTP 409 sem código reconhecido',
        };
      }

      if (this.ehStatusDeFalhaTecnica(resposta.status)) {
        this.registrarFalhaTecnicaHttp(operacao, resposta.status);
        return {
          tipo: 'indeterminado',
          motivo: `HTTP ${resposta.status}`,
        };
      }

      return {
        tipo: 'indeterminado',
        motivo: `HTTP ${resposta.status}: erro de negócio`,
      };
    } catch (erro) {
      this.registrarFalhaTecnica(operacao, this.motivoDoErro(erro));
      return {
        tipo: 'indeterminado',
        motivo:
          erro instanceof Error ? erro.message : 'Erro na requisição à order',
      };
    }
  }

  private ehStatusDeFalhaTecnica(status: number): boolean {
    return status >= 500 || status === 408;
  }

  private registrarFalhaTecnicaHttp(
    operacao: OperacaoMercadoPago,
    statusHttp: number,
  ): void {
    const motivo = statusHttp === 408 ? 'timeout' : 'http_5xx';
    this.registrarFalhaTecnica(operacao, motivo, statusHttp);
  }

  // O fetch com AbortSignal.timeout rejeita com TimeoutError; qualquer outra
  // rejeição é falha de conexão. O nome é lido sem instanceof porque o
  // DOMException pode vir de outro contexto de execução (ex.: sandbox do Jest).
  private motivoDoErro(erro: unknown): MotivoFalhaTecnicaMercadoPago {
    const nome = (erro as { name?: unknown } | null)?.name;
    return nome === 'TimeoutError' ? 'timeout' : 'rede';
  }

  private registrarFalhaTecnica(
    operacao: OperacaoMercadoPago,
    motivo: MotivoFalhaTecnicaMercadoPago,
    statusHttp?: number,
  ): void {
    this.logger.warn(
      serializarFalhaTecnicaMercadoPago({ operacao, motivo, statusHttp }),
    );
  }

  private extrairCodigoConflito409(
    corpo: Record<string, unknown>,
  ): string | null {
    const errors = corpo.errors;
    if (Array.isArray(errors)) {
      for (const item of errors) {
        if (item && typeof item === 'object') {
          const registro = item as Record<string, unknown>;
          if (typeof registro.code === 'string') {
            return registro.code;
          }
          if (typeof registro.message === 'string') {
            const msg = registro.message;
            if (
              [
                'cannot_cancel_order',
                'order_already_refunded',
                'refund_in_progress',
                'movement_operations_pending',
              ].includes(msg)
            ) {
              return msg;
            }
          }
        }
      }
    }
    if (typeof corpo.status_detail === 'string') {
      return corpo.status_detail;
    }
    return null;
  }

  private extrairRefundedAmountCentavos(
    corpo: Record<string, unknown>,
  ): number | undefined {
    const valor = corpo.refunded_amount;
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      return Math.round(valor * 100);
    }
    if (typeof valor === 'string' && valor.trim()) {
      const n = Number(valor);
      if (Number.isFinite(n)) {
        return Math.round(n * 100);
      }
    }
    return undefined;
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
