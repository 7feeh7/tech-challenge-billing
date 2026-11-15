import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ConsultaOrderResumo {
  orderId: string;
  status: string | undefined;
  statusDetail: string | undefined;
  consultadoEm: string;
  indisponivel: boolean;
  motivoIndisponivel?: string;
}

@Injectable()
export class ConsultarOrderMercadoPagoService {
  constructor(private readonly config: ConfigService) {}

  async consultar(orderId: string): Promise<ConsultaOrderResumo> {
    const token = this.config.get<string>('MP_ACCESS_TOKEN')?.trim();
    const baseUrl =
      this.config.get<string>('MP_API_BASE_URL')?.trim() ||
      'https://api.mercadopago.com';
    const timeoutMs = Number(
      this.config.get<string>('MP_REQUEST_TIMEOUT_MS') ?? '30000',
    );

    if (!token) {
      return {
        orderId,
        status: undefined,
        statusDetail: undefined,
        consultadoEm: new Date().toISOString(),
        indisponivel: true,
        motivoIndisponivel: 'MP_ACCESS_TOKEN não configurado',
      };
    }

    const url = `${baseUrl}/v1/orders/${orderId}`;
    try {
      const resposta = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const texto = await resposta.text();
      let corpo: Record<string, unknown> = {};
      try {
        corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
      } catch {
        return {
          orderId,
          status: undefined,
          statusDetail: undefined,
          consultadoEm: new Date().toISOString(),
          indisponivel: true,
          motivoIndisponivel: `Resposta não JSON (HTTP ${resposta.status})`,
        };
      }

      return {
        orderId,
        status: typeof corpo.status === 'string' ? corpo.status : undefined,
        statusDetail:
          typeof corpo.status_detail === 'string'
            ? corpo.status_detail
            : undefined,
        consultadoEm: new Date().toISOString(),
        indisponivel: !resposta.ok,
        motivoIndisponivel: resposta.ok ? undefined : `HTTP ${resposta.status}`,
      };
    } catch (erro) {
      const mensagem =
        erro instanceof Error ? erro.message : 'Erro desconhecido na consulta';
      return {
        orderId,
        status: undefined,
        statusDetail: undefined,
        consultadoEm: new Date().toISOString(),
        indisponivel: true,
        motivoIndisponivel: mensagem,
      };
    }
  }
}
