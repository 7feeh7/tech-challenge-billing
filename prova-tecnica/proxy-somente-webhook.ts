/**
 * Proxy local E05: só encaminha POST /v1/webhooks/mercado-pago ao Billing.
 * Demais rotas retornam 404 — use este porto no cloudflared, não o 3000.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.WEBHOOK_PROXY_PORT ?? '8787');
const ALVO =
  process.env.BILLING_WEBHOOK_ALVO?.trim() ||
  'http://127.0.0.1:3000/v1/webhooks/mercado-pago';

const caminhoPermitido = '/v1/webhooks/mercado-pago';

async function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const pedaco of req) {
    partes.push(pedaco as Buffer);
  }
  return Buffer.concat(partes);
}

function copiarCabecalhos(
  req: IncomingMessage,
  init: Record<string, string> = {},
): Headers {
  const headers = new Headers(init);
  for (const [chave, valor] of Object.entries(req.headers)) {
    if (valor === undefined) {
      continue;
    }
    const nome = chave.toLowerCase();
    if (nome === 'host' || nome === 'connection' || nome === 'content-length') {
      continue;
    }
    headers.set(chave, Array.isArray(valor) ? valor.join(',') : valor);
  }
  return headers;
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${url.pathname}${url.search}`,
  );

  if (url.pathname !== caminhoPermitido) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        erro: 'Somente /v1/webhooks/mercado-pago é exposto neste túnel.',
      }),
    );
    return;
  }

  // Painel MP costuma validar URL com GET/HEAD antes do POST assinado.
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      res.end(JSON.stringify({ status: 'ok', rota: 'webhook-prova-e05' }));
    } else {
      res.end();
    }
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD, POST');
    res.end(JSON.stringify({ erro: 'Método não permitido.' }));
    return;
  }

  const corpo = await lerCorpo(req);
  const alvoUrl = new URL(ALVO);
  alvoUrl.search = url.search;

  try {
    const upstream = await fetch(alvoUrl.toString(), {
      method: 'POST',
      headers: copiarCabecalhos(req, {
        'Content-Type':
          (req.headers['content-type'] as string) ?? 'application/json',
      }),
      body: new Uint8Array(corpo),
    });
    const texto = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') ?? 'application/json',
    );
    res.end(texto);
  } catch (erro) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        erro: 'Billing indisponível no encaminhamento.',
        detalhe: erro instanceof Error ? erro.message : 'erro',
      }),
    );
  }
});

servidor.listen(PORT, '127.0.0.1', () => {
  console.log(
    `Proxy webhook E05 em http://127.0.0.1:${PORT}${caminhoPermitido} → ${ALVO}`,
  );
});