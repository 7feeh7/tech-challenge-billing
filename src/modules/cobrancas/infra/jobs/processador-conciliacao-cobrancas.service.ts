import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { calcularPosseCobrancaMs } from '../../application/calcular-posse-cobranca';
import type { CobrancaGateway } from '../../application/ports/cobranca.gateway';
import { COBRANCA_GATEWAY } from '../../application/ports/tokens';
import { ConciliarCobrancaService } from '../../application/services/conciliar-cobranca.service';

@Injectable()
export class ProcessadorConciliacaoCobrancasService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ProcessadorConciliacaoCobrancasService.name,
  );
  private intervalo?: NodeJS.Timeout;
  private readonly habilitado: boolean;
  private readonly intervaloMs: number;
  private readonly posseMs: number;
  private readonly lote: number;

  constructor(
    private readonly config: ConfigService,
    private readonly conciliar: ConciliarCobrancaService,
    @Inject(COBRANCA_GATEWAY)
    private readonly cobrancas: CobrancaGateway,
  ) {
    this.habilitado =
      this.config.get<string>('COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO') ===
      'true';
    this.intervaloMs = Number(
      this.config.get<string>('COBRANCA_CONCILIACAO_PROCESSADOR_INTERVAL_MS') ??
        '10000',
    );
    this.lote = Number(
      this.config.get<string>('COBRANCA_CONCILIACAO_PROCESSADOR_LOTE') ?? '10',
    );
    const loteCriacao = Number(
      this.config.get<string>('COBRANCA_CRIACAO_PROCESSADOR_LOTE') ?? '5',
    );
    const mpTimeout = Number(
      this.config.get<string>('MP_REQUEST_TIMEOUT_MS') ?? '30000',
    );
    const overridePosse = this.config.get<string>('COBRANCA_REIVINDICACAO_MS');
    this.posseMs = calcularPosseCobrancaMs({
      loteConciliacao: this.lote,
      loteCriacao,
      mpRequestTimeoutMs: mpTimeout,
      overrideMs: overridePosse ? Number(overridePosse) : undefined,
    });
  }

  onModuleInit(): void {
    if (!this.habilitado) return;
    this.intervalo = setInterval(() => {
      void this.processarLote().catch((erro) =>
        this.logger.error('Falha na conciliação ativa de cobranças', erro),
      );
    }, this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  async processarLote(): Promise<void> {
    const pendentes = await this.cobrancas.reivindicarPendentesConciliacao(
      this.lote,
      this.posseMs,
    );
    for (const cobranca of pendentes) {
      if (!cobranca.id) continue;
      await this.conciliar.conciliarPorCobrancaId(cobranca.id);
    }
  }
}
