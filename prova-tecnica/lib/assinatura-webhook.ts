import { createHmac, timingSafeEqual } from 'node:crypto';

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

export function validarAssinaturaWebhook(params: {
  dataId: string;
  requestId: string | undefined;
  assinaturaCabecalho: string | undefined;
  segredo: string;
  toleranciaSegundos?: number;
}): boolean {
  if (!params.assinaturaCabecalho?.trim() || !params.requestId?.trim()) {
    return false;
  }

  const mapa = new Map<string, string>();
  for (const trecho of params.assinaturaCabecalho.split(',')) {
    const [chave, ...resto] = trecho.split('=');
    if (!chave || resto.length === 0) continue;
    mapa.set(chave.trim(), resto.join('=').trim());
  }

  const ts = Number(mapa.get('ts'));
  const v1 = mapa.get('v1');
  if (!Number.isFinite(ts) || !v1) return false;

  const tolerancia = params.toleranciaSegundos ?? 300;
  const agora = Math.floor(Date.now() / 1000);
  if (Math.abs(agora - ts) > tolerancia) return false;

  const manifest = `id:${params.dataId};request-id:${params.requestId};ts:${ts};`;
  const esperado = createHmac('sha256', params.segredo)
    .update(manifest)
    .digest('hex');
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}