import { RegistroNotificacaoWebhookService } from './registro-notificacao-webhook.service';

describe('RegistroNotificacaoWebhookService', () => {
  it('marca duplicata quando o mesmo request-id e order-id repetem', () => {
    const servico = new RegistroNotificacaoWebhookService();
    const base = {
      recebidaEm: new Date().toISOString(),
      requestId: 'req-1',
      notificacaoId: '1',
      orderId: 'ORD1',
      tipo: 'order',
      acao: 'order.updated',
    };

    const primeira = servico.registrar(
      { requestId: 'req-1', orderId: 'ORD1' },
      base,
    );
    const segunda = servico.registrar(
      { requestId: 'req-1', orderId: 'ORD1' },
      base,
    );

    expect(primeira.duplicada).toBe(false);
    expect(segunda.duplicada).toBe(true);
    expect(servico.quantidadeRegistrosUnicos()).toBe(1);
  });
});
