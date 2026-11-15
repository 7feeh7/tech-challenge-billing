/**
 * Servidor mínimo E05 quando o Nest/Prisma não está disponível (ex.: Docker parado).
 * Mesma rota e validação HMAC do Billing; grava entregas em resultados/webhook-entregas.jsonl.
 */
import { createServer } from 'node:http';
import { ValidarAssinaturaWebhookService } from '../src/modules/webhook-mercado-pago/validar-assinatura-webhook.service';
import { ClienteOrders } from './lib/cliente-orders';
import { carregarConfiguracaoE05 } from './lib/configuracao-e05';
import { persistirEntregaWebhook } from './lib/persistir-entrega-webhook';

const PORT = Number(process.env.PORT ?? '3000');
const vistos = new Set<string>();
const validar = new ValidarAssinaturaWebhookService();

async function main(): Promise<void> {
  const cfg = carregarConfiguracaoE05();
  const orders = new ClienteOrders(cfg);

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (req.method !== 'POST' || url.pathname !== '/v1/webhooks/mercado-pago') {
      res.statusCode = 404;
      res.end('{}');
      return;
    }

    const dataId = url.searchParams.get('data.id') ?? '';
    const requestId = req.headers['x-request-id'] as string | undefined;
    const assinatura = req.headers['x-signature'] as string | undefined;

    const assinaturaOk =
      dataId &&
      validar.validar({
        dataId,
        requestId,
        assinaturaCabecalho: assinatura,
        segredo: cfg.webhookSecret,
      }).valida;

    if (!assinaturaOk) {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: 'Assinatura inválida' }));
      return;
    }

    const chave = `${requestId}::${dataId}`;
    const duplicado = vistos.has(chave);
    if (!duplicado) {
      vistos.add(chave);
    }

    const consulta = await orders.consultarOrder(dataId);
    const corpo = consulta.corpoSanitizado as {
      status?: string;
      status_detail?: string;
    };

    persistirEntregaWebhook({
      recebidaEm: new Date().toISOString(),
      orderId: dataId,
      requestId: requestId!,
      duplicado,
      assinaturaValida: true,
      origem: 'mercado_pago',
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        recebido: true,
        duplicado,
        requestId,
        orderId: dataId,
        situacaoFinanceira: {
          statusOrder: corpo.status,
          statusDetail: corpo.status_detail,
        },
      }),
    );
  });

  servidor.listen(PORT, '127.0.0.1', () => {
    console.log(
      `[E05 fallback] webhook em http://127.0.0.1:${PORT}/v1/webhooks/mercado-pago`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});