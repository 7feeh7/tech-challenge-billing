import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { AvisoWebhookGateway } from '../ports/aviso-webhook.gateway';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import { ConciliarCobrancaService } from '../services/conciliar-cobranca.service';

export interface EntradaNotificacaoMercadoPago {
  mercadoPagoOrderId: string;
  requestId?: string;
  notificacaoId?: string;
  tipo?: string;
  acao?: string;
}

export interface ResultadoProcessarNotificacao {
  cobrancaId?: string;
  situacao?: string;
  efeitoAplicado: boolean;
}

export class ProcessarNotificacaoMercadoPagoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly avisos: AvisoWebhookGateway,
    private readonly conciliar: ConciliarCobrancaService,
  ) {}

  async execute(
    entrada: EntradaNotificacaoMercadoPago,
  ): Promise<ResultadoProcessarNotificacao> {
    const cobrancaAntes = await this.cobrancas.buscarPorMercadoPagoOrderId(
      entrada.mercadoPagoOrderId,
    );

    await this.unitOfWork.executar(async (ctx) => {
      await this.avisos.registrar(ctx, {
        mercadoPagoOrderId: entrada.mercadoPagoOrderId,
        cobrancaId: cobrancaAntes?.id ?? null,
        requestId: entrada.requestId ?? null,
        notificacaoId: entrada.notificacaoId ?? null,
        tipo: entrada.tipo ?? null,
        acao: entrada.acao ?? null,
      });
    });

    const cobrancaDepois = await this.conciliar.conciliarPorMercadoPagoOrderId(
      entrada.mercadoPagoOrderId,
    );

    return {
      cobrancaId: cobrancaDepois?.id,
      situacao: cobrancaDepois?.situacao,
      efeitoAplicado: Boolean(
        cobrancaDepois &&
          cobrancaAntes &&
          cobrancaAntes.situacao !== cobrancaDepois.situacao,
      ),
    };
  }
}
