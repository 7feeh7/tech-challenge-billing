import { gerarAssinaturaWebhook } from './assinatura-webhook';

export interface RespostaWebhookLocal {
  status: number;
  corpo: unknown;
  duracaoMs: number;
}

export class ClienteWebhookLocal {
  constructor(
    private readonly baseUrl: string,
    private readonly segredo: string,
  ) {}

  async enviarNotificacao(opcoes: {
    orderId: string;
    requestId: string;
    action?: string;
    tipo?: string;
    assinatura?: string;
    queryProvaSimularFalha?: boolean;
  }): Promise<RespostaWebhookLocal> {
    const inicio = Date.now();
    const assinatura =
      opcoes.assinatura ??
      gerarAssinaturaWebhook(
        opcoes.orderId,
        opcoes.requestId,
        this.segredo,
      );

    const params = new URLSearchParams({
      'data.id': opcoes.orderId,
      type: opcoes.tipo ?? 'order',
    });
    if (opcoes.queryProvaSimularFalha) {
      params.set('prova_simular_falha', '1');
    }

    const url = `${this.baseUrl}/v1/webhooks/mercado-pago?${params.toString()}`;
    const corpo = {
      action: opcoes.action ?? 'order.updated',
      type: 'order',
      data: { id: opcoes.orderId },
      id: Date.now(),
    };

    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': assinatura,
        'x-request-id': opcoes.requestId,
      },
      body: JSON.stringify(corpo),
    });

    const texto = await resposta.text();
    let corpoJson: unknown = texto;
    try {
      corpoJson = texto ? JSON.parse(texto) : null;
    } catch {
      corpoJson = { raw: texto.slice(0, 300) };
    }

    return {
      status: resposta.status,
      corpo: corpoJson,
      duracaoMs: Date.now() - inicio,
    };
  }
}