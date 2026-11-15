import { Injectable } from '@nestjs/common';

export interface NotificacaoWebhookRegistrada {
  recebidaEm: string;
  requestId: string;
  notificacaoId: string | undefined;
  orderId: string;
  tipo: string | undefined;
  acao: string | undefined;
  duplicada: boolean;
}

interface ChaveNotificacao {
  requestId: string;
  orderId: string;
}

/**
 * Armazenamento em memória só para a prova técnica E05. Substituído na E17 por persistência.
 */
@Injectable()
export class RegistroNotificacaoWebhookService {
  private readonly vistos = new Set<string>();

  registrar(
    chave: ChaveNotificacao,
    metadados: Omit<NotificacaoWebhookRegistrada, 'duplicada'>,
  ): NotificacaoWebhookRegistrada {
    const idComposto = `${chave.requestId}::${chave.orderId}`;
    const duplicada = this.vistos.has(idComposto);
    if (!duplicada) {
      this.vistos.add(idComposto);
    }
    return { ...metadados, duplicada };
  }

  limpar(): void {
    this.vistos.clear();
  }

  quantidadeRegistrosUnicos(): number {
    return this.vistos.size;
  }
}
