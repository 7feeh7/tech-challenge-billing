import type { ConfiguracaoProva } from './configuracao';
import { sanitizarObjeto } from './sanitizar';

export interface RespostaHttp<T = unknown> {
  status: number;
  headers: Record<string, string>;
  corpo: T;
  corpoSanitizado: T;
  duracaoMs: number;
}

export interface CriarOrderInput {
  externalReference: string;
  totalAmount: string;
  expirationTime?: string;
  idempotencyKey: string;
}

export class ClienteOrders {
  constructor(private readonly cfg: ConfiguracaoProva) {}

  async criarOrder(input: CriarOrderInput): Promise<RespostaHttp> {
    const corpo = {
      type: 'online',
      processing_mode: 'manual',
      total_amount: input.totalAmount,
      external_reference: input.externalReference,
      expiration_time: input.expirationTime,
      payer: { email: this.cfg.payerEmail },
      items: [
        {
          title: 'Prova técnica E04 — cobrança oficina',
          unit_price: input.totalAmount,
          quantity: 1,
        },
      ],
    };

    return this.requisicao('POST', '/v1/orders', {
      corpo,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async consultarOrder(orderId: string): Promise<RespostaHttp> {
    return this.requisicao('GET', `/v1/orders/${orderId}`);
  }

  async cancelarOrder(
    orderId: string,
    idempotencyKey: string,
  ): Promise<RespostaHttp> {
    return this.requisicao('POST', `/v1/orders/${orderId}/cancel`, {
      idempotencyKey,
    });
  }

  async estornarTotal(
    orderId: string,
    idempotencyKey: string,
  ): Promise<RespostaHttp> {
    return this.requisicao('POST', `/v1/orders/${orderId}/refund`, {
      idempotencyKey,
    });
  }

  async estornarParcial(
    orderId: string,
    idempotencyKey: string,
    paymentTransactionId: string,
    amount: string,
  ): Promise<RespostaHttp> {
    const corpo = {
      transactions: [{ id: paymentTransactionId, amount }],
    };
    return this.requisicao('POST', `/v1/orders/${orderId}/refund`, {
      corpo,
      idempotencyKey,
    });
  }

  async requisicaoComTimeoutForcado(
    caminho: string,
    timeoutMs: number,
  ): Promise<{ erro: string; duracaoMs: number }> {
    const inicio = Date.now();
    const url = `${this.cfg.apiBaseUrl}${caminho}`;
    try {
      await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return {
        erro: 'nenhum (inesperado: resposta antes do timeout)',
        duracaoMs: Date.now() - inicio,
      };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.name : 'ErroDesconhecido';
      return { erro: mensagem, duracaoMs: Date.now() - inicio };
    }
  }

  private async requisicao(
    metodo: string,
    caminho: string,
    opcoes?: { corpo?: unknown; idempotencyKey?: string },
  ): Promise<RespostaHttp> {
    const inicio = Date.now();
    const url = `${this.cfg.apiBaseUrl}${caminho}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.accessToken}`,
      Accept: 'application/json',
    };
    if (opcoes?.corpo !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opcoes?.idempotencyKey) {
      headers['X-Idempotency-Key'] = opcoes.idempotencyKey;
    }

    const resposta = await fetch(url, {
      method: metodo,
      headers,
      body:
        opcoes?.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
    });

    const texto = await resposta.text();
    let corpo: unknown = texto;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = { raw: texto.slice(0, 500) };
    }

    const headersResposta: Record<string, string> = {};
    resposta.headers.forEach((valor, chave) => {
      headersResposta[chave] = valor;
    });

    return {
      status: resposta.status,
      headers: headersResposta,
      corpo: corpo as never,
      corpoSanitizado: sanitizarObjeto(corpo) as never,
      duracaoMs: Date.now() - inicio,
    };
  }
}
