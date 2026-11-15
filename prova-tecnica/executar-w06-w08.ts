import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ClienteOrders } from './lib/cliente-orders';
import { carregarConfiguracaoE05 } from './lib/configuracao-e05';
import { aguardar, extrairPaymentTransactionId, extrairStatus } from './lib/registro';

const PASTA = resolve(__dirname, 'resultados');
const WEBHOOK_LOG = resolve(PASTA, 'webhook-entregas.jsonl');

interface Evidencia {
  id: string;
  resultado: 'comprovado' | 'limitado' | 'indisponível' | 'pendente';
  observacoes: string;
  dados?: Record<string, unknown>;
}

async function pollOrder(
  cliente: ClienteOrders,
  orderId: string,
  predicado: (status?: string, detail?: string) => boolean,
  timeoutMs: number,
  intervaloMs = 5_000,
): Promise<Record<string, unknown> | undefined> {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    const get = await cliente.consultarOrder(orderId);
    const corpo = get.corpoSanitizado as {
      status?: string;
      status_detail?: string;
    };
    if (predicado(corpo.status, corpo.status_detail)) {
      return {
        status_http: get.status,
        status: corpo.status,
        status_detail: corpo.status_detail,
      };
    }
    await aguardar(intervaloMs);
  }
  return undefined;
}

function linhasWebhook(): Array<Record<string, unknown>> {
  if (!existsSync(WEBHOOK_LOG)) {
    return [];
  }
  return readFileSync(WEBHOOK_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((linha) => JSON.parse(linha) as Record<string, unknown>);
}

async function w06(cliente: ClienteOrders): Promise<Evidencia> {
  const orderExistente = process.env.MP_ORDER_W06_ID?.trim();
  if (orderExistente) {
    const get = await cliente.consultarOrder(orderExistente);
    const corpo = get.corpoSanitizado as Record<string, unknown>;
    return {
      id: 'W06',
      resultado:
        extrairStatus(corpo) === 'processed' ? 'comprovado' : 'pendente',
      observacoes:
        'Use MP_ORDER_W06_ID após FUND+APRO no mesmo checkout; script só valida GET final.',
      dados: { get: corpo },
    };
  }

  const order = await cliente.criarOrder({
    externalReference: `e05-w06-${randomUUID()}`,
    totalAmount: '212.00',
    expirationTime: 'PT30M',
    idempotencyKey: randomUUID(),
  });
  const orderId = (order.corpoSanitizado as { id?: string }).id;
  const checkoutUrl = (order.corpoSanitizado as { checkout_url?: string })
    .checkout_url;

  console.log('\n[W06] 1) Checkout anônimo, titular FUND nesta URL:');
  console.log(checkoutUrl);
  console.log('[W06] 2) Depois APRO na MESMA URL (mesma order).');
  console.log(`[W06] 3) Exporte MP_ORDER_W06_ID=${orderId} e reexecute este script.\n`);

  return {
    id: 'W06',
    resultado: 'pendente',
    observacoes: 'Aguardando pagamentos manuais FUND → APRO.',
    dados: { order_id: orderId, checkout_url: checkoutUrl },
  };
}

async function w07(cliente: ClienteOrders): Promise<Evidencia> {
  const orderId = process.env.MP_ORDER_W07_ID?.trim();
  if (!orderId) {
    const criada = await cliente.criarOrder({
      externalReference: `e05-w07-${randomUUID()}`,
      totalAmount: '217.00',
      expirationTime: 'PT30M',
      idempotencyKey: randomUUID(),
    });
    const id = (criada.corpoSanitizado as { id?: string }).id;
    const url = (criada.corpoSanitizado as { checkout_url?: string })
      .checkout_url;
    console.log('\n[W07] Pague com APRO e exporte MP_ORDER_W07_ID:');
    console.log(url);
    console.log(`MP_ORDER_W07_ID=${id}\n`);
    return {
      id: 'W07',
      resultado: 'pendente',
      observacoes: 'Order de estorno ainda não paga.',
      dados: { order_id: id },
    };
  }

  const consulta = await cliente.consultarOrder(orderId);
  if (extrairStatus(consulta.corpoSanitizado) !== 'processed') {
    return {
      id: 'W07',
      resultado: 'pendente',
      observacoes: 'Order ainda não está processed para estorno.',
      dados: { status: extrairStatus(consulta.corpoSanitizado) },
    };
  }

  const payId = extrairPaymentTransactionId(consulta.corpoSanitizado);
  if (!payId) {
    return { id: 'W07', resultado: 'indisponível', observacoes: 'Sem payment id.' };
  }

  await cliente.estornarParcial(orderId, randomUUID(), payId, '50.00');
  const chaveTotal = randomUUID();
  const primeira = await cliente.estornarTotal(orderId, chaveTotal);
  const mesmaChave = await cliente.estornarTotal(orderId, chaveTotal);

  return {
    id: 'W07',
    resultado:
      primeira.status === 409
        ? 'comprovado'
        : 'limitado',
    observacoes:
      'Política D3.15: após 409, mesma X-Idempotency-Key deve ecoar resultado sem novo estorno (comparar HTTP/corpo).',
    dados: {
      primeira_total: { status_http: primeira.status },
      mesma_chave_reenvio: {
        status_http: mesmaChave.status,
        mesmo_status_que_primeira: mesmaChave.status === primeira.status,
      },
    },
  };
}

async function w08(cliente: ClienteOrders): Promise<Evidencia> {
  const order = await cliente.criarOrder({
    externalReference: `e05-w08-${randomUUID()}`,
    totalAmount: '108.00',
    expirationTime: 'PT3M',
    idempotencyKey: randomUUID(),
  });
  const orderId = (order.corpoSanitizado as { id?: string }).id;
  console.log(`\n[W08] Order ${orderId} expira em ~3m; aguarde webhook ou GET...\n`);

  const antesWebhook = linhasWebhook().length;
  const getFinal = await pollOrder(
    cliente,
    orderId!,
    (s, d) => s === 'canceled' && d === 'expired',
    6 * 60_000,
    15_000,
  );
  const depois = linhasWebhook();
  const novas = depois.slice(antesWebhook).filter((l) => l.orderId === orderId);

  return {
    id: 'W08',
    resultado: getFinal ? (novas.length > 0 ? 'comprovado' : 'limitado') : 'indisponível',
    observacoes: novas.length
      ? 'Webhook de expiração recebido.'
      : 'Expiração comprovada por GET; webhook orders_v2 não registrado em webhook-entregas.jsonl.',
    dados: {
      get_final: getFinal,
      webhooks_novos: novas.map((l) => ({
        requestId: l.requestId,
        duplicado: l.duplicado,
        acao: l.acao,
      })),
    },
  };
}

async function main(): Promise<void> {
  const cfg = carregarConfiguracaoE05();
  const cliente = new ClienteOrders(cfg);
  const evidencias: Evidencia[] = [];

  evidencias.push(await w06(cliente));
  if (process.env.E05_SOMENTE_W06 === '1') {
    // atalho
  } else {
    evidencias.push(await w07(cliente));
    if (process.env.E05_PULAR_W08 !== '1') {
      evidencias.push(await w08(cliente));
    }
  }

  mkdirSync(PASTA, { recursive: true });
  const arquivo = resolve(
    PASTA,
    `e05-w06-w08-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(arquivo, `${JSON.stringify({ evidencias }, null, 2)}\n`);
  console.log(`Evidências em ${arquivo}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});