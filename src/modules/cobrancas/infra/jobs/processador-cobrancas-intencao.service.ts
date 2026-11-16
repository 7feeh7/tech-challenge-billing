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
import { CriarOrderMercadoPagoService } from '../../application/services/criar-order-mercado-pago.service';

@Injectable()
export class ProcessadorCobrancasIntencaoService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ProcessadorCobrancasIntencaoService.name,
  );
  private intervalo?: NodeJS.Timeout;
  private readonly habilitado: boolean;
  private readonly intervaloMs: number;
  private readonly posseMs: number;
  private readonly lote: number;

  constructor(
    private readonly config: ConfigService,
    private readonly criarOrder: CriarOrderMercadoPagoService,
    @Inject(COBRANCA_GATEWAY)
    private readonly cobrancas: CobrancaGateway,
  ) {
    this.habilitado =
      this.config.get<string>('COBRANCA_CRIACAO_PROCESSADOR_HABILITADO') ===
      'true';
    this.intervaloMs = Number(
      this.config.get<string>('COBRANCA_CRIACAO_PROCESSADOR_INTERVAL_MS') ??
        '10000',
    );
    this.lote = Number(
      this.config.get<string>('COBRANCA_CRIACAO_PROCESSADOR_LOTE') ?? '5',
    );
    const loteConciliacao = Number(
      this.config.get<string>('COBRANCA_CONCILIACAO_PROCESSADOR_LOTE') ?? '10',
    );
    const mpTimeout = Number(
      this.config.get<string>('MP_REQUEST_TIMEOUT_MS') ?? '30000',
    );
    const loteExpiracao = Number(
      this.config.get<string>('COBRANCA_EXPIRACAO_PROCESSADOR_LOTE') ?? '10',
    );
    const overridePosse = this.config.get<string>('COBRANCA_REIVINDICACAO_MS');
    this.posseMs = calcularPosseCobrancaMs({
      loteConciliacao,
      loteCriacao: this.lote,
      loteExpiracao,
      mpRequestTimeoutMs: mpTimeout,
      overrideMs: overridePosse ? Number(overridePosse) : undefined,
    });
  }

  onModuleInit(): void {
    if (!this.habilitado) return;
    this.intervalo = setInterval(() => {
      void this.processarLote().catch((erro) =>
        this.logger.error(
          'Falha ao criar orders para cobranças em intenção',
          erro,
        ),
      );
    }, this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  async processarLote(): Promise<void> {
    const reivindicadas = await this.cobrancas.reivindicarIntencoesCriacaoOrder(
      this.lote,
      this.posseMs,
    );
    for (const cobranca of reivindicadas) {
      if (!cobranca.id) continue;
      await this.criarOrder.executar(cobranca.id);
    }
  }
}
