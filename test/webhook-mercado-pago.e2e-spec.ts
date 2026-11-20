jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../src/shared/generated/prisma/client', () => ({
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));

import { randomUUID } from 'node:crypto';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ProcessarNotificacaoMercadoPagoUseCase } from '../src/modules/cobrancas/application/use-cases/processar-notificacao-mercado-pago.use-case';
import { ValidarAssinaturaWebhookService } from '../src/modules/webhook-mercado-pago/validar-assinatura-webhook.service';
import { WebhookMercadoPagoController } from '../src/modules/webhook-mercado-pago/webhook-mercado-pago.controller';
import { gerarAssinaturaWebhook } from '../src/shared/testing/gerar-assinatura-webhook';

describe('Webhook Mercado Pago (e2e)', () => {
  let app: NestFastifyApplication;
  const segredo = 'segredo-e2e-teste';

  beforeAll(async () => {
    process.env.MP_WEBHOOK_SECRET = segredo;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [WebhookMercadoPagoController],
      providers: [
        ValidarAssinaturaWebhookService,
        ConfigService,
        {
          provide: ProcessarNotificacaoMercadoPagoUseCase,
          useValue: {
            execute: jest.fn().mockResolvedValue({
              cobrancaId: 'c-e2e',
              situacao: 'PENDENTE',
              efeitoAplicado: false,
            }),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('aceita assinatura válida com 200', async () => {
    const orderId = 'ORDTST01E2ETEST00000000002';
    const requestId = randomUUID();
    const assinatura = gerarAssinaturaWebhook(orderId, requestId, segredo);

    const response = await request(app.getHttpServer())
      .post(`/v1/webhooks/mercado-pago?data.id=${orderId}&type=order`)
      .set('x-request-id', requestId)
      .set('x-signature', assinatura)
      .send({
        type: 'order',
        action: 'order.updated',
        data: { id: orderId },
      });

    expect(response.status).toBe(200);
    expect(response.body.recebido).toBe(true);
    expect(response.body.cobrancaId).toBe('c-e2e');
  });
});
