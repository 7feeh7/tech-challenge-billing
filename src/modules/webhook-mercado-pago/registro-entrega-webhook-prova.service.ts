import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EntregaWebhookProva {
  recebidaEm: string;
  orderId: string;
  requestId: string;
  notificacaoId?: string;
  tipo?: string;
  acao?: string;
  duplicado: boolean;
}

@Injectable()
export class RegistroEntregaWebhookProvaService {
  constructor(private readonly config: ConfigService) {}

  registrar(entrega: EntregaWebhookProva): void {
    if (this.config.get<string>('MP_WEBHOOK_PROVA_HABILITADA') !== 'true') {
      return;
    }

    const pasta = join(process.cwd(), 'prova-tecnica', 'resultados');
    mkdirSync(pasta, { recursive: true });
    const arquivo = join(pasta, 'webhook-entregas.jsonl');
    appendFileSync(
      arquivo,
      `${JSON.stringify({ ...entrega, origem: 'mercado_pago' })}\n`,
      'utf8',
    );
  }
}
