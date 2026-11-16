import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FILA_MENSAGENS,
  type FilaMensagensGateway,
} from '../../application/ports/fila-mensagens.gateway';
import {
  EVENTO_CANCELAR_FINANCEIRO,
  EVENTO_GERAR_ORCAMENTO,
} from '../../envelope';
import { validarEnvelopeBase } from '../../validar-envelope';

export const PROCESSADOR_GERAR_ORCAMENTO = Symbol(
  'PROCESSADOR_GERAR_ORCAMENTO',
);

export interface ProcessadorGerarOrcamento {
  processar(envelope: unknown): Promise<void>;
}

export const PROCESSADOR_CANCELAR_FINANCEIRO = Symbol(
  'PROCESSADOR_CANCELAR_FINANCEIRO',
);

export interface ProcessadorCancelarFinanceiro {
  processar(envelope: unknown): Promise<void>;
}

@Injectable()
export class ConsumidorFilaBillingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConsumidorFilaBillingService.name);
  private intervalo?: NodeJS.Timeout;
  private readonly habilitado: boolean;
  private readonly filaUrl?: string;
  private readonly intervaloMs: number;

  constructor(
    private readonly config: ConfigService,
    @Inject(FILA_MENSAGENS)
    private readonly fila: FilaMensagensGateway,
    @Inject(PROCESSADOR_GERAR_ORCAMENTO)
    private readonly gerarOrcamento: ProcessadorGerarOrcamento,
    @Inject(PROCESSADOR_CANCELAR_FINANCEIRO)
    private readonly cancelarFinanceiro: ProcessadorCancelarFinanceiro,
  ) {
    this.filaUrl = config.get<string>('SQS_BILLING_IN_URL');
    this.habilitado =
      config.get<string>('SQS_CONSUMER_HABILITADO') === 'true' &&
      !!this.filaUrl;
    this.intervaloMs = Number(
      config.get<string>('SQS_CONSUMER_INTERVAL_MS') ?? '1000',
    );
  }

  onModuleInit(): void {
    if (!this.habilitado || !this.filaUrl) return;

    this.intervalo = setInterval(() => {
      void this.poller().catch((erro) =>
        this.logger.error('Falha no consumidor SQS', erro),
      );
    }, this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  async poller(): Promise<void> {
    if (!this.filaUrl) return;

    const mensagens = await this.fila.receber(this.filaUrl, 5);
    for (const mensagem of mensagens) {
      try {
        const envelope = JSON.parse(mensagem.corpo) as unknown;
        validarEnvelopeBase(envelope);

        if (envelope.eventType === EVENTO_GERAR_ORCAMENTO) {
          await this.gerarOrcamento.processar(envelope);
        } else if (envelope.eventType === EVENTO_CANCELAR_FINANCEIRO) {
          await this.cancelarFinanceiro.processar(envelope);
        }

        await this.fila.confirmar(this.filaUrl, mensagem.receiptHandle);
      } catch (erro) {
        this.logger.warn(
          'Mensagem não confirmada; nova tentativa pela visibilidade SQS',
          erro instanceof Error ? erro.message : erro,
        );
      }
    }
  }
}
