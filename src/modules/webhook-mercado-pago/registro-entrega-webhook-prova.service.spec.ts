import { ConfigService } from '@nestjs/config';
import { RegistroEntregaWebhookProvaService } from './registro-entrega-webhook-prova.service';

jest.mock('node:fs', () => ({
  appendFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('RegistroEntregaWebhookProvaService', () => {
  it('não grava arquivo quando prova desabilitada', () => {
    const config = { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService;
    const service = new RegistroEntregaWebhookProvaService(config);
    service.registrar({
      recebidaEm: new Date().toISOString(),
      orderId: '1',
      requestId: '2',
      duplicado: false,
    });
    const { appendFileSync } = jest.requireMock('node:fs');
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('grava arquivo quando prova habilitada', () => {
    const config = { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService;
    const service = new RegistroEntregaWebhookProvaService(config);
    service.registrar({
      recebidaEm: new Date().toISOString(),
      orderId: '1',
      requestId: '2',
      duplicado: true,
    });
    const { appendFileSync } = jest.requireMock('node:fs');
    expect(appendFileSync).toHaveBeenCalled();
  });
});