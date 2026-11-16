import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { calcularPosseCancelamentoFinanceiroMs } from '@/modules/cobrancas/application/calcular-posse-cobranca';
import type { OperacaoFinanceiraGateway } from '../../application/ports/operacao-financeira.gateway';
import { OPERACAO_FINANCEIRA_GATEWAY } from '../../application/ports/tokens';
import { ExecutarCancelamentoFinanceiroService } from '../../application/services/executar-cancelamento-financeiro.service';

@Injectable()
export class ProcessadorOperacoesFinanceirasService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ProcessadorOperacoesFinanceirasService.name,
  );
  private intervalo?: NodeJS.Timeout;
  private readonly habilitado: boolean;
  private readonly intervaloMs: number;
  private readonly posseMs: number;
  private readonly lote: number;

  constructor(
    private readonly config: ConfigService,
    private readonly executar: ExecutarCancelamentoFinanceiroService,
    @Inject(OPERACAO_FINANCEIRA_GATEWAY)
    private readonly operacoes: OperacaoFinanceiraGateway,
  ) {
    this.habilitado =
      this.config.get<string>(
        'CANCELAMENTO_FINANCEIRO_PROCESSADOR_HABILITADO',
      ) === 'true';
    this.intervaloMs = Number(
      this.config.get<string>(
        'CANCELAMENTO_FINANCEIRO_PROCESSADOR_INTERVAL_MS',
      ) ?? '10000',
    );
    this.lote = Number(
      this.config.get<string>('CANCELAMENTO_FINANCEIRO_PROCESSADOR_LOTE') ??
        '5',
    );
    const mpTimeout = Number(
      this.config.get<string>('MP_REQUEST_TIMEOUT_MS') ?? '30000',
    );
    const overrideRaw =
      this.config.get<string>('CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS') ??
      this.config.get<string>('COBRANCA_REIVINDICACAO_MS');
    const override = overrideRaw ? Number(overrideRaw) : undefined;
    this.posseMs = calcularPosseCancelamentoFinanceiroMs({
      lote: this.lote,
      mpRequestTimeoutMs: mpTimeout,
      overrideMs: override,
    });
  }

  onModuleInit(): void {
    if (!this.habilitado) return;
    this.intervalo = setInterval(() => {
      void this.processarLote().catch((erro) =>
        this.logger.error('Falha ao processar operações financeiras', erro),
      );
    }, this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  async processarLote(): Promise<void> {
    const reivindicadas = await this.operacoes.reivindicarEmAndamento(
      this.lote,
      this.posseMs,
    );
    for (const operacao of reivindicadas) {
      await this.executar.executar(operacao.id);
    }
  }
}
