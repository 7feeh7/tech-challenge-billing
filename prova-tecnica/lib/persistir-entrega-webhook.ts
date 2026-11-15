import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ARQUIVO = resolve(__dirname, '../resultados/webhook-entregas.jsonl');

export interface LinhaEntregaWebhook {
  recebidaEm: string;
  orderId: string;
  requestId: string;
  notificacaoId?: string;
  tipo?: string;
  acao?: string;
  duplicado: boolean;
  assinaturaValida: boolean;
  origem: 'mercado_pago' | 'script_local';
}

export function persistirEntregaWebhook(linha: LinhaEntregaWebhook): void {
  mkdirSync(resolve(__dirname, '../resultados'), { recursive: true });
  appendFileSync(ARQUIVO, `${JSON.stringify(linha)}\n`, 'utf8');
}