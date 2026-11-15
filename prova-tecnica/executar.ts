import { randomUUID } from 'node:crypto';
import { ClienteOrders } from './lib/cliente-orders';
import { carregarConfiguracao } from './lib/configuracao';
import { gerarRelatorioMd } from './lib/gerar-relatorio';
import {
  aguardar,
  extrairCheckoutUrl,
  extrairOrderId,
  extrairPaymentTransactionId,
  extrairStatus,
  type RegistroCenario,
  RegistroExecucao,
} from './lib/registro';

const VALOR_PADRAO = '150.00';

function requisicaoResumo(
  metodo: string,
  caminho: string,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return { metodo, caminho, ...extras };
}

async function cenarioCriarOrder(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<string | undefined> {
  const idempotencyKey = randomUUID();
  const externalReference = `cobranca-prova-${randomUUID()}`;
  const resposta = await cliente.criarOrder({
    externalReference,
    totalAmount: VALOR_PADRAO,
    expirationTime: 'PT15M',
    idempotencyKey,
  });

  const orderId = extrairOrderId(resposta.corpoSanitizado);
  const checkoutUrl = extrairCheckoutUrl(resposta.corpoSanitizado);
  const item: RegistroCenario = {
    id: 'C01',
    titulo: 'Criar order (Checkout Pro / Orders API)',
    resultado:
      resposta.status === 201 && orderId && checkoutUrl
        ? 'comprovado'
        : 'limitado',
    decisoes: ['D3.15', 'D3.10', 'billing.md — criar cobrança'],
    requisicao: requisicaoResumo('POST', '/v1/orders', {
      external_reference: externalReference,
      expiration_time: 'PT15M',
      idempotency_key: '[uuid]',
    }),
    resposta: {
      status_http: resposta.status,
      duracao_ms: resposta.duracaoMs,
      corpo: resposta.corpoSanitizado,
    },
    comportamento:
      resposta.status === 201
        ? 'Order criada com id, checkout_url e external_reference ecoado.'
        : `Falha na criação (HTTP ${resposta.status}).`,
  };
  registro.adicionar(item);
  return orderId;
}

async function cenarioIdempotencia(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const chave = randomUUID();
  const ref = `cobranca-prova-idem-${randomUUID()}`;
  const primeira = await cliente.criarOrder({
    externalReference: ref,
    totalAmount: '101.00',
    expirationTime: 'PT15M',
    idempotencyKey: chave,
  });
  const segunda = await cliente.criarOrder({
    externalReference: ref,
    totalAmount: '101.00',
    expirationTime: 'PT15M',
    idempotencyKey: chave,
  });

  const id1 = extrairOrderId(primeira.corpoSanitizado);
  const id2 = extrairOrderId(segunda.corpoSanitizado);
  const mesmoId = Boolean(id1 && id2 && id1 === id2);
  const item: RegistroCenario = {
    id: 'C02',
    titulo: 'Idempotência na criação (mesma X-Idempotency-Key)',
    resultado: mesmoId ? 'comprovado' : 'limitado',
    decisoes: ['D3.15', 'D3.11'],
    requisicao: requisicaoResumo('POST', '/v1/orders', {
      tentativas: 2,
      mesma_idempotency_key: true,
    }),
    resposta: {
      primeira: {
        status_http: primeira.status,
        order_id: id1,
      },
      segunda: {
        status_http: segunda.status,
        order_id: id2,
      },
    },
    comportamento: mesmoId
      ? 'Segunda chamada retornou o mesmo order id.'
      : 'Ids divergentes ou ausentes — revisar política de idempotência.',
  };
  registro.adicionar(item);
}

async function cenarioConsulta(
  cliente: ClienteOrders,
  orderId: string | undefined,
  registro: RegistroExecucao,
): Promise<void> {
  if (!orderId) {
    registro.adicionar({
      id: 'C03',
      titulo: 'Consultar order por id',
      resultado: 'indisponivel',
      decisoes: ['D3.10', 'D4.5'],
      comportamento: 'Sem order id da criação anterior.',
    });
    return;
  }

  const resposta = await cliente.consultarOrder(orderId);
  const corpo = resposta.corpoSanitizado as Record<string, unknown>;
  const item: RegistroCenario = {
    id: 'C03',
    titulo: 'Consultar order (situação e identificação da cobrança)',
    resultado: resposta.status === 200 ? 'comprovado' : 'limitado',
    decisoes: ['D3.10', 'D4.5', 'billing.md — confirmar por consulta'],
    requisicao: requisicaoResumo('GET', `/v1/orders/${orderId}`),
    resposta: {
      status_http: resposta.status,
      duracao_ms: resposta.duracaoMs,
      corpo,
    },
    comportamento:
      'Consulta retorna status, external_reference e transações quando existirem.',
    observacoes:
      'Horário efetivo de aprovação: campo a localizar em transactions.payments após pagamento (cenários C06/C07).',
  };
  registro.adicionar(item);
}

async function cenarioCancelarSemPagamento(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const order = await cliente.criarOrder({
    externalReference: `cobranca-cancel-${randomUUID()}`,
    totalAmount: '102.00',
    expirationTime: 'PT15M',
    idempotencyKey: randomUUID(),
  });
  const orderId = extrairOrderId(order.corpoSanitizado);
  if (!orderId) {
    registro.adicionar({
      id: 'C04',
      titulo: 'Cancelar order sem pagamento',
      resultado: 'indisponivel',
      decisoes: ['D4.5', 'billing.md — cancelar'],
      comportamento: 'Não foi possível criar order para cancelamento.',
    });
    return;
  }

  const cancel = await cliente.cancelarOrder(orderId, randomUUID());
  const consulta = await cliente.consultarOrder(orderId);
  const status = extrairStatus(consulta.corpoSanitizado);
  const item: RegistroCenario = {
    id: 'C04',
    titulo: 'Cancelar order sem pagamento',
    resultado:
      cancel.status === 200 && status === 'canceled'
        ? 'comprovado'
        : 'limitado',
    decisoes: ['D4.5', 'D1.15', 'billing.md — POST cancel'],
    requisicao: requisicaoResumo('POST', `/v1/orders/${orderId}/cancel`),
    resposta: {
      cancelamento: {
        status_http: cancel.status,
        corpo: cancel.corpoSanitizado,
      },
      consulta: {
        status_http: consulta.status,
        status_order: status,
      },
    },
    comportamento:
      'Cancelamento de order não paga e consulta subsequente com status canceled.',
  };
  registro.adicionar(item);
}

async function cenarioExpiracao(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const order = await cliente.criarOrder({
    externalReference: `cobranca-exp-${randomUUID()}`,
    totalAmount: '103.00',
    expirationTime: 'PT45S',
    idempotencyKey: randomUUID(),
  });
  const orderId = extrairOrderId(order.corpoSanitizado);
  if (!orderId) {
    registro.adicionar({
      id: 'C05',
      titulo: 'Expiração (expiration_time curto)',
      resultado: 'indisponivel',
      decisoes: ['D4.6', 'D3.11'],
      comportamento: 'Order não criada para teste de expiração.',
    });
    return;
  }

  await aguardar(50_000);
  const consulta = await cliente.consultarOrder(orderId);
  const status = extrairStatus(consulta.corpoSanitizado);
  const expirou = status === 'canceled' || status === 'expired';
  registro.adicionar({
    id: 'C05',
    titulo: 'Expiração (expiration_time PT45S)',
    resultado: expirou ? 'comprovado' : 'limitado',
    decisoes: ['D4.6', 'D3.11', 'billing.md — expirada = canceled'],
    requisicao: requisicaoResumo('POST', '/v1/orders', {
      expiration_time: 'PT45S',
    }),
    resposta: {
      consulta_apos_50s: {
        status_http: consulta.status,
        status_order: status,
        corpo: consulta.corpoSanitizado,
      },
    },
    comportamento: expirou
      ? 'Após o prazo, consulta indica order encerrada sem pagamento.'
      : `Status após espera: ${status ?? 'desconhecido'}.`,
    observacoes:
      'Demonstração D4.6: prazo pagamento 3 min → validar PT3M em E17; aqui usamos PT45S por tempo de execução.',
  });
}

async function cenarioTimeout(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const resultado = await cliente.requisicaoComTimeoutForcado(
    '/v1/orders/0',
    1,
  );
  registro.adicionar({
    id: 'C11',
    titulo: 'Timeout simulado (AbortSignal)',
    resultado:
      resultado.erro === 'TimeoutError' || resultado.erro === 'AbortError'
        ? 'comprovado'
        : 'limitado',
    decisoes: ['D3.10', 'D3.11'],
    requisicao: requisicaoResumo('GET', '/v1/orders/{id}', {
      timeout_ms: 1,
    }),
    resposta: resultado,
    comportamento:
      'Cliente interrompe a requisição antes da resposta; erro classificável como técnico (D3.10).',
  });
}

async function cenarioPagamentoAprovadoPendente(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<{ orderId?: string; checkoutUrl?: string }> {
  const order = await cliente.criarOrder({
    externalReference: `cobranca-aprov-${randomUUID()}`,
    totalAmount: '200.00',
    expirationTime: 'PT30M',
    idempotencyKey: randomUUID(),
  });
  const orderId = extrairOrderId(order.corpoSanitizado);
  const checkoutUrl = extrairCheckoutUrl(order.corpoSanitizado);

  const executarPagamento = process.env.MP_ORDER_PAGA_ID?.trim();
  const orderPaga = executarPagamento
    ? await cliente.consultarOrder(executarPagamento)
    : null;
  const statusPago = orderPaga
    ? extrairStatus(orderPaga.corpoSanitizado)
    : null;

  registro.adicionar({
    id: 'C06',
    titulo: 'Pagamento aprovado (cartão de teste APRO)',
    resultado:
      statusPago === 'processed' || statusPago === 'paid'
        ? 'comprovado'
        : 'pendente',
    decisoes: ['D3.2', 'D3.11', 'D4.5'],
    requisicao: requisicaoResumo('Checkout Pro', checkoutUrl ?? '(url)'),
    resposta: orderPaga
      ? { consulta: orderPaga.corpoSanitizado }
      : {
          order_criada: order.corpoSanitizado,
          instrucao:
            'Abra checkout_url, pague com cartão teste e titular APRO; exporte MP_ORDER_PAGA_ID e rode de novo.',
        },
    comportamento:
      statusPago === 'processed' || statusPago === 'paid'
        ? 'Pagamento aprovado confirmado por GET /v1/orders.'
        : 'Aguarda conclusão manual no checkout (documentação MP).',
    hipoteseDocumentacao: !orderPaga,
  });

  return { orderId, checkoutUrl };
}

async function cenarioPagamentoRecusadoPendente(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const order = await cliente.criarOrder({
    externalReference: `cobranca-recus-${randomUUID()}`,
    totalAmount: '201.00',
    expirationTime: 'PT30M',
    idempotencyKey: randomUUID(),
  });
  const orderId = extrairOrderId(order.corpoSanitizado);
  const consultaId = process.env.MP_ORDER_RECUSADA_ID?.trim();
  const consulta = consultaId
    ? await cliente.consultarOrder(consultaId)
    : orderId
      ? await cliente.consultarOrder(orderId)
      : null;
  const status = consulta ? extrairStatus(consulta.corpoSanitizado) : undefined;
  const recusada = status === 'failed' || status === 'rejected';

  registro.adicionar({
    id: 'C07',
    titulo: 'Pagamento recusado (cartão de teste FUND)',
    resultado: recusada ? 'comprovado' : 'pendente',
    decisoes: ['D1.15', 'D3.11', 'billing.md — recusa'],
    requisicao: requisicaoResumo('Checkout Pro', 'titular FUND'),
    resposta: consulta
      ? { status_order: status, corpo: consulta.corpoSanitizado }
      : { order_criada: order.corpoSanitizado },
    comportamento: recusada
      ? 'Order em status de falha/recusa após tentativa no checkout.'
      : 'Requer pagamento no checkout com titular FUND; opcional MP_ORDER_RECUSADA_ID.',
    hipoteseDocumentacao: !recusada,
  });
}

async function cenarioCancelarOrderPaga(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const orderPagaId = process.env.MP_ORDER_PAGA_ID?.trim();
  if (!orderPagaId) {
    registro.adicionar({
      id: 'C08',
      titulo: 'Tentar cancelar order já paga',
      resultado: 'pendente',
      decisoes: ['D4.5', 'billing.md — só created/action_required'],
      comportamento:
        'Depende de order paga (C06). Documentação: cancel só em created/action_required.',
      hipoteseDocumentacao: true,
    });
    return;
  }

  const cancel = await cliente.cancelarOrder(orderPagaId, randomUUID());
  registro.adicionar({
    id: 'C08',
    titulo: 'Tentar cancelar order já paga',
    resultado: cancel.status >= 400 ? 'comprovado' : 'limitado',
    decisoes: ['D4.5', 'billing.md'],
    requisicao: requisicaoResumo('POST', `/v1/orders/${orderPagaId}/cancel`),
    resposta: {
      status_http: cancel.status,
      corpo: cancel.corpoSanitizado,
    },
    comportamento:
      cancel.status >= 400
        ? 'API rejeita cancelamento de order paga (esperado).'
        : `HTTP ${cancel.status} — revisar se cancelamento foi aceito indevidamente.`,
  });
}

async function cenarioEstornoTotal(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const orderPagaId = process.env.MP_ORDER_PAGA_ID?.trim();
  if (!orderPagaId) {
    registro.adicionar({
      id: 'C09',
      titulo: 'Estorno total',
      resultado: 'pendente',
      decisoes: ['D1.20', 'D3.11'],
      comportamento: 'Requer order paga (variável MP_ORDER_PAGA_ID).',
      hipoteseDocumentacao: true,
    });
    return;
  }

  const antes = await cliente.consultarOrder(orderPagaId);
  const estorno = await cliente.estornarTotal(orderPagaId, randomUUID());
  const depois = await cliente.consultarOrder(orderPagaId);
  const status = extrairStatus(depois.corpoSanitizado);

  registro.adicionar({
    id: 'C09',
    titulo: 'Estorno total (POST refund corpo vazio)',
    resultado:
      estorno.status >= 200 && estorno.status < 300 ? 'comprovado' : 'limitado',
    decisoes: ['D1.20', 'D3.11', 'billing.md — estorno'],
    requisicao: requisicaoResumo('POST', `/v1/orders/${orderPagaId}/refund`),
    resposta: {
      antes: antes.corpoSanitizado,
      estorno: { status_http: estorno.status, corpo: estorno.corpoSanitizado },
      depois: { status_order: status, corpo: depois.corpoSanitizado },
    },
    comportamento:
      'Estorno solicitado após pagamento; consulta reflete reembolso.',
    observacoes:
      'Conta de teste pode exigir saldo fictício — registrar se API retornar erro de saldo.',
  });
}

async function cenarioEstornoParcial(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const orderParcialId = process.env.MP_ORDER_PARCIAL_ID?.trim();
  if (!orderParcialId) {
    registro.adicionar({
      id: 'C10',
      titulo: 'Estorno parcial',
      resultado: 'pendente',
      decisoes: ['D1.20', 'D2.17'],
      comportamento:
        'Requer segunda order paga (MP_ORDER_PARCIAL_ID) sem estorno total prévio.',
      hipoteseDocumentacao: true,
    });
    return;
  }

  const consulta = await cliente.consultarOrder(orderParcialId);
  const paymentId = extrairPaymentTransactionId(consulta.corpoSanitizado);
  if (!paymentId) {
    registro.adicionar({
      id: 'C10',
      titulo: 'Estorno parcial',
      resultado: 'limitado',
      decisoes: ['D1.20'],
      comportamento: 'Não foi possível obter id da transação de pagamento.',
      resposta: { corpo: consulta.corpoSanitizado },
    });
    return;
  }

  const estorno = await cliente.estornarParcial(
    orderParcialId,
    randomUUID(),
    paymentId,
    '50.00',
  );
  registro.adicionar({
    id: 'C10',
    titulo: 'Estorno parcial',
    resultado:
      estorno.status >= 200 && estorno.status < 300 ? 'comprovado' : 'limitado',
    decisoes: ['D1.20', 'D3.11'],
    requisicao: requisicaoResumo(
      'POST',
      `/v1/orders/${orderParcialId}/refund`,
      {
        amount: '50.00',
      },
    ),
    resposta: {
      status_http: estorno.status,
      corpo: estorno.corpoSanitizado,
    },
    comportamento: 'Refund parcial com transactions[].amount.',
  });
}

async function cenarioLimitesExpiration(
  cliente: ClienteOrders,
  registro: RegistroExecucao,
): Promise<void> {
  const tentativas = ['PT3M', 'PT5M', 'P1D'];
  const resultados: Record<string, unknown>[] = [];
  for (const expiration of tentativas) {
    const resposta = await cliente.criarOrder({
      externalReference: `cobranca-exp-limit-${randomUUID()}`,
      totalAmount: '104.00',
      expirationTime: expiration,
      idempotencyKey: randomUUID(),
    });
    resultados.push({
      expiration_time: expiration,
      status_http: resposta.status,
      order_id: extrairOrderId(resposta.corpoSanitizado),
      erro: resposta.status >= 400 ? resposta.corpoSanitizado : undefined,
    });
  }

  const d46Ok = resultados.some(
    (r) => r.expiration_time === 'PT3M' && r.status_http === 201,
  );
  registro.adicionar({
    id: 'C05b',
    titulo: 'Limites de expiration_time (incl. PT3M — D4.6 demonstração)',
    resultado: d46Ok ? 'comprovado' : 'limitado',
    decisoes: ['D4.6', 'D3.11'],
    requisicao: requisicaoResumo('POST', '/v1/orders', {
      valores_testados: tentativas,
    }),
    resposta: { tentativas: resultados },
    comportamento:
      'API aceita valores ISO 8601 usados no projeto; PT3M comprovado ou rejeição documentada.',
  });
}

async function main(): Promise<void> {
  const cfg = carregarConfiguracao();
  const cliente = new ClienteOrders(cfg);
  const registro = new RegistroExecucao();

  const orderId = await cenarioCriarOrder(cliente, registro);
  await cenarioIdempotencia(cliente, registro);
  await cenarioConsulta(cliente, orderId, registro);
  await cenarioCancelarSemPagamento(cliente, registro);
  await cenarioLimitesExpiration(cliente, registro);
  await cenarioExpiracao(cliente, registro);
  await cenarioTimeout(cliente, registro);
  await cenarioPagamentoAprovadoPendente(cliente, registro);
  await cenarioPagamentoRecusadoPendente(cliente, registro);
  await cenarioCancelarOrderPaga(cliente, registro);
  await cenarioEstornoTotal(cliente, registro);
  await cenarioEstornoParcial(cliente, registro);

  const jsonPath = registro.persistirJson();
  gerarRelatorioMd(registro.listar());
  console.log(`RELATORIO.md e ${jsonPath} atualizados.`);
  for (const item of registro.listar()) {
    console.log(`${item.id} ${item.titulo}: ${item.resultado}`);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
