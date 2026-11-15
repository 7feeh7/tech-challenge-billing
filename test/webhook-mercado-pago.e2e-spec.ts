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
import { ConfigModule } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ValidarAssinaturaWebhookService } from '../src/modules/webhook-mercado-pago/validar-assinatura-webhook.service';
import { WebhookMercadoPagoModule } from '../src/modules/webhook-mercado-pago/webhook-mercado-pago.module';

describe('Webhook Mercado Pago (e2e)', () => {
  let app: NestFastifyApplication;
  const segredo = 'segredo-e2e-teste';
  const validar = new ValidarAssinaturaWebhookService();

  beforeAll(async () => {
    process.env.MP_WEBHOOK_SECRET = segredo;
    process.env.MP_WEBHOOK_PROVA_HABILITADA = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        WebhookMercadoPagoModule,
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
    await app.close();
  });

  it('aceita assinatura válida com 200 (rejeição 401 coberta em *.spec.ts)', async () => {
    const orderId = 'ORDTST01E2ETEST00000000002';
    const requestId = randomUUID();
    const assinatura = validar.gerarAssinaturaParaProva(
      orderId,
      requestId,
      segredo,
    );

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
    expect(response.body.duplicado).toBe(false);
  });
});
