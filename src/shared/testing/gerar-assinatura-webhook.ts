import { createHmac } from 'node:crypto';

export function gerarAssinaturaWebhook(
  dataId: string,
  requestId: string,
  segredo: string,
  ts = Math.floor(Date.now() / 1000),
): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = createHmac('sha256', segredo).update(manifest).digest('hex');
  return `ts=${ts},v1=${hash}`;
}
