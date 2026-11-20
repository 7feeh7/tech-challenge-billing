import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ClienteOrders } from './lib/cliente-orders';
import { ClienteWebhookLocal } from './lib/cliente-webhook-local';
import { carregarConfiguracaoE05 } from './lib/configuracao-e05';
import {
  extrairPaymentTransactionId,
  type RegistroCenario,
  RegistroExecucao,
} from './lib/registro';

const PASTA_RESULTADOS = resolve(__dirname, 'resultados');

interface ResultadoE05 {
  geradoEm: string;
  cenarios: RegistroCenario[];
}

function persistirResultado(registro: RegistroExecucao): void {
  mkdirSync(PASTA_RESULTADOS, { recursive: true });
  const arquivo = resolve(
    PASTA_RESULTADOS,
    `e05-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  const payload: ResultadoE05 = {
    geradoEm: new Date().toISOString(),
    cenarios: registro.listar(),
  };
  writeFileSync(arquivo, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`Resultados em ${arquivo}`);
}

async function cenarioAssinaturaValida(
  cliente: ClienteWebhookLocal,
  registro: RegistroExecucao,
  orderId: string,
): Promise<void> {
  const requestId = randomUUID();
  const resposta = await cliente.enviarNotificacao({
    orderId,
    requestId,
    action: 'order.processed',
  });
  const item: RegistroCenario = {
    id: 'W01',
    titulo: 'Webhook orders_v2 — assinatura HMAC válida',
    resultado:
      resposta.status === 200 &&
      typeof resposta.corpo === 'object' &&
      resposta.corpo !== null &&
      (resposta.corpo as { recebido?: boolean }).recebido === true
        ? 'comprovado'
        : 'limitado',
    decisoes: ['D3.10', 'D3.11', 'billing.md — validar x-signature'],
    requisicao: {
      metodo: 'POST',
      caminho: '/v1/webhooks/mercado-pago',
      order_id: orderId,
    },
    resposta: {
      status_http: resposta.status,
      duracao_ms: resposta.duracaoMs,
      corpo: resposta.corpo,
    },
    comportamento: 'Notificação com x-signature válida retorna 2xx.',
  };
  registro.adicionar(item);
}

async function cenarioAssinaturaInvalida(
  cliente: ClienteWebhookLocal,
  registro: RegistroExecucao,
  orderId: string,
): Promise<void> {
  const requestId = randomUUID();
  const resposta = await cliente.enviarNotificacao({
    orderId,
    requestId,
    assinatura: 'ts=1,v1=assinatura-invalida',
  });
  const item: RegistroCenario = {
    id: 'W02',
    titulo: 'Webhook — assinatura inválida rejeitada',
    resultado: resposta.status === 401 ? 'comprovado' : 'limitado',
    decisoes: ['D3.10'],
    requisicao: {
      metodo: 'POST',
      caminho: '/v1/webhooks/mercado-pago',
      assinatura: 'inválida',
    },
    resposta: {
      status_http: resposta.status,
      duracao_ms: resposta.duracaoMs,
    },
    comportamento: 'Assinatura inválida retorna 401.',
  };
  registro.adicionar(item);
}

async function cenarioDuplicata(
  cliente: ClienteWebhookLocal,
  registro: RegistroExecucao,
  orderId: string,
): Promise<void> {
  const requestId = randomUUID();
  const primeira = await cliente.enviarNotificacao({ orderId, requestId });
  const segunda = await cliente.enviarNotificacao({ orderId, requestId });
  const duplicado =
    segunda.status === 200 &&
    typeof segunda.corpo === 'object' &&
    segunda.corpo !== null &&
    (segunda.corpo as { duplicado?: boolean }).duplicado === true;

  const item: RegistroCenario = {
    id: 'W03',
    titulo: 'Webhook — notificação duplicada (mesmo x-request-id)',
    resultado:
      primeira.status === 200 && duplicado ? 'comprovado' : 'limitado',
    decisoes: ['D3.11', 'D3.15'],
    requisicao: {
      metodo: 'POST',
      tentativas: 2,
      mesmo_x_request_id: true,
    },
    resposta: {
      primeira: { status_http: primeira.status },
      segunda: { status_http: segunda.status, corpo: segunda.corpo },
    },
    comportamento:
      'Segunda entrega com o mesmo x-request-id retorna 2xx e marca duplicado.',
  };
  registro.adicionar(item);
}

async function cenarioReenvioAposFalha(
  cliente: ClienteWebhookLocal,
  registro: RegistroExecucao,
  orderId: string,
): Promise<void> {
  const requestId = randomUUID();
  const falha = await cliente.enviarNotificacao({
    orderId,
    requestId,
    queryProvaSimularFalha: true,
  });
  const sucesso = await cliente.enviarNotificacao({ orderId, requestId });

  const item: RegistroCenario = {
    id: 'W04',
    titulo: 'Webhook — reenvio após resposta não 2xx (simulação local)',
    resultado:
      falha.status === 503 && sucesso.status === 200 ? 'comprovado' : 'limitado',
    decisoes: ['D3.11'],
    requisicao: {
      metodo: 'POST',
      prova_simular_falha: true,
      requer_MP_WEBHOOK_PROVA_HABILITADA: 'true',
    },
    resposta: {
      falha: { status_http: falha.status },
      reenvio: { status_http: sucesso.status },
    },
    comportamento:
      'Primeira chamada com falha simulada retorna 503; reenvio com mesma chave retorna 200.',
    observacoes:
      'Reenvio real do Mercado Pago depende do túnel e do painel (ver RELATORIO-E05.md).',
  };
  registro.adicionar(item);
}

async function cenarioConciliacaoGet(
  cliente: ClienteWebhookLocal,
  clienteOrders: ClienteOrders,
  registro: RegistroExecucao,
  orderId: string,
): Promise<void> {
  const requestId = randomUUID();
  const webhook = await cliente.enviarNotificacao({
    orderId,
    requestId,
    action: 'order.processed',
  });
  const get = await clienteOrders.consultarOrder(orderId);

  const situacaoWebhook =
    typeof webhook.corpo === 'object' && webhook.corpo !== null
      ? (webhook.corpo as { situacaoFinanceira?: { statusOrder?: string } })
          .situacaoFinanceira?.statusOrder
      : undefined;
  const statusGet =
    typeof get.corpoSanitizado === 'object' && get.corpoSanitizado !== null
      ? (get.corpoSanitizado as { status?: string }).status
      : undefined;

  const item: RegistroCenario = {
    id: 'W05',
    titulo: 'Situação financeira conciliada por GET order após webhook',
    resultado:
      webhook.status === 200 &&
      get.status === 200 &&
      situacaoWebhook &&
      statusGet &&
      situacaoWebhook === statusGet
        ? 'comprovado'
        : situacaoWebhook && statusGet
          ? 'limitado'
          : 'indisponível',
    decisoes: ['D3.10', 'D4.5'],
    requisicao: {
      webhook: 'POST /v1/webhooks/mercado-pago',
      consulta: `GET /v1/orders/${orderId}`,
    },
    resposta: {
      webhook: { status_http: webhook.status, status_order: situacaoWebhook },
      get: { status_http: get.status, status_order: statusGet },
    },
    comportamento:
      'Após webhook válido, o endpoint consulta a Orders API e ecoa o status.',
  };
  registro.adicionar(item);
}

async function cenarioEstornoIdempotencia409(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
  orderId: string,
): Promise<void> {
  const consulta = await cliente.consultarOrder(orderId);
  const paymentId = extrairPaymentTransactionId(consulta.corpoSanitizado);
  if (!paymentId) {
    registro.adicionar({
      id: 'W07',
      titulo: 'Estorno — mesma X-Idempotency-Key após 409 genérico',
      resultado: 'indisponível',
      decisoes: ['D3.15'],
      requisicao: {},
      resposta: { motivo: 'Order sem payment id para estorno parcial' },
      comportamento: 'Requer MP_ORDER_PAGA_ID com pagamento accredited.',
    });
    return;
  }

  const chaveParcial = randomUUID();
  await cliente.estornarParcial(orderId, chaveParcial, paymentId, '50.00');
  const chaveTotal = randomUUID();
  const primeira = await cliente.estornarTotal(orderId, chaveTotal);
  const reutilizada = await cliente.estornarTotal(orderId, chaveTotal);
  const novaChave = randomUUID();
  const segunda = await cliente.estornarTotal(orderId, novaChave);

  const mesmaChaveRepeteResposta =
    primeira.status === 409 &&
    (reutilizada.status === 409 || reutilizada.status === 201);
  const novaChaveSucesso = segunda.status === 201;

  const item: RegistroCenario = {
    id: 'W07',
    titulo: 'Estorno — política após 409 (mesma chave vs nova chave)',
    resultado:
      mesmaChaveRepeteResposta && novaChaveSucesso ? 'comprovado' : 'limitado',
    decisoes: ['D3.15', 'D3.10'],
    requisicao: {
      sequencia: 'parcial → total 409 → mesma chave → nova chave',
    },
    resposta: {
      primeira_total: { status_http: primeira.status },
      mesma_chave: { status_http: reutilizada.status },
      nova_chave: { status_http: segunda.status },
    },
    comportamento:
      'Após 409 genérico, reutilizar a chave não executa novo estorno; nova chave conclui quando a API permite.',
    observacoes:
      'Comportamento alinhado à E04 (C09); mesma chave após 409 não substitui nova tentativa comprovada.',
  };
  registro.adicionar(item);
}

async function cenarioNovaTentativaPagamento(
  clienteOrders: ClienteOrders,
  registro: RegistroExecucao,
  orderRecusadaId: string | undefined,
): Promise<void> {
  if (!orderRecusadaId) {
    registro.adicionar({
      id: 'W06',
      titulo: 'Nova tentativa na mesma order após recusa FUND',
      resultado: 'indisponível',
      decisoes: ['D1.15'],
      requisicao: {},
      resposta: {},
      comportamento:
        'Defina MP_ORDER_RECUSADA_ID após recusa FUND e repague com APRO no mesmo checkout_url.',
    });
    return;
  }

  const get = await clienteOrders.consultarOrder(orderRecusadaId);
  const corpo = get.corpoSanitizado as {
    status?: string;
    status_detail?: string;
    checkout_url?: string;
  };

  const item: RegistroCenario = {
    id: 'W06',
    titulo: 'Nova tentativa na mesma order após recusa FUND',
    resultado:
      get.status === 200 &&
      corpo.status === 'action_required' &&
      corpo.status_detail === 'waiting_retry'
        ? 'comprovado'
        : corpo.status === 'processed'
          ? 'comprovado'
          : 'limitado',
    decisoes: ['D1.15', 'D3.15'],
    requisicao: {
      metodo: 'GET',
      caminho: `/v1/orders/${orderRecusadaId}`,
    },
    resposta: {
      status_http: get.status,
      status_order: corpo.status,
      status_detail: corpo.status_detail,
      checkout_url_mantido: Boolean(corpo.checkout_url),
    },
    comportamento:
      'Order recusada permanece apta a nova tentativa com o mesmo checkout_url até comprovar APRO manual no checkout.',
    observacoes:
      'Aprovação na mesma order após FUND exige checkout manual (APRO); comprovar com nova consulta processed.',
  };
  registro.adicionar(item);
}

async function main(): Promise<void> {
  const cfg = carregarConfiguracaoE05();
  const registro = new RegistroExecucao();
  const webhook = new ClienteWebhookLocal(cfg.webhookBaseUrl, cfg.webhookSecret);
  const orders = new ClienteOrders(cfg);

  const orderReferencia =
    cfg.orderPagaId ?? 'ORDTST01M7GH2KEG5AH9PXBNF8S3AQ8A';

  await cenarioAssinaturaValida(webhook, registro, orderReferencia);
  await cenarioAssinaturaInvalida(webhook, registro, orderReferencia);
  await cenarioDuplicata(webhook, registro, orderReferencia);
  await cenarioReenvioAposFalha(webhook, registro, orderReferencia);
  await cenarioConciliacaoGet(webhook, orders, registro, orderReferencia);
  await cenarioNovaTentativaPagamento(orders, registro, cfg.orderRecusadaId);

  if (cfg.orderPagaId) {
    await cenarioEstornoIdempotencia409(orders, registro, cfg.orderPagaId);
  } else {
    registro.adicionar({
      id: 'W07',
      titulo: 'Estorno — mesma X-Idempotency-Key após 409 genérico',
      resultado: 'indisponível',
      decisoes: ['D3.15'],
      requisicao: {},
      resposta: { motivo: 'MP_ORDER_PAGA_ID não informado' },
      comportamento: 'Usar order paga da E04.',
    });
  }

  registro.adicionar({
    id: 'W08',
    titulo: 'Notificação de expiração orders_v2',
    resultado: 'limitado',
    decisoes: ['D3.11', 'D4.5'],
    requisicao: {},
    resposta: {},
    comportamento:
      'Expiração observada na E04 por GET (canceled/expired assíncrono). Webhook dedicado de expiração não comprovado neste ambiente de teste; conciliação por GET permanece alternativa documentada (D3.11).',
  });

  persistirResultado(registro);

  const pendentes = registro
    .listar()
    .filter((c) => c.resultado !== 'comprovado');
  if (pendentes.length > 0) {
    console.log(
      `Cenários não comprovados: ${pendentes.map((c) => c.id).join(', ')}`,
    );
    process.exitCode = 0;
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});