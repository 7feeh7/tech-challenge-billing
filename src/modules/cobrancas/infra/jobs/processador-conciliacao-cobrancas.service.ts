import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
      this.config.get<string>('COBRANCA_CONCILIACAO_PROCESSADOR_HABILITADO') !==
      'false';
    this.intervaloMs = Number(
      this.config.get<string>('COBRANCA_CONCILIACAO_PROCESSADOR_INTERVAL_MS') ??
        '10000',
    );
    this.posseMs = Number(
      this.config.get<string>('COBRANCA_REIVINDICACAO_MS') ?? '35000',
    );
    this.lote = Number(
      this.config.get<string>('COBRANCA_CONCILIACAO_PROCESSADOR_LOTE') ?? '10',
    );
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
