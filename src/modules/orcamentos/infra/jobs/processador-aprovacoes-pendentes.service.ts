import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  rastreamentoDoErro,
  serializarFalhaItemLote,
} from '@/shared/observability/falha-item-lote';
import type { OrcamentoGateway } from '../../application/ports/orcamento.gateway';
import { ORCAMENTO_GATEWAY } from '../../application/ports/tokens';
import { AprovarOrcamentoUseCase } from '../../application/use-cases/aprovar-orcamento.use-case';
import type { Orcamento } from '../../domain/entities/orcamento.entity';

@Injectable()
export class ProcessadorAprovacoesPendentesService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ProcessadorAprovacoesPendentesService.name,
  );
  private intervalo?: NodeJS.Timeout;
  private readonly habilitado: boolean;
  private readonly intervaloMs: number;
  private readonly posseMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly aprovarOrcamento: AprovarOrcamentoUseCase,
    @Inject(ORCAMENTO_GATEWAY)
    private readonly orcamentos: OrcamentoGateway,
  ) {
    this.habilitado =
      this.config.get<string>('APROVACAO_PROCESSADOR_HABILITADO') === 'true';
    this.intervaloMs = Number(
      this.config.get<string>('APROVACAO_PROCESSADOR_INTERVAL_MS') ?? '10000',
    );
    this.posseMs = Number(
      this.config.get<string>('APROVACAO_REIVINDICACAO_MS') ?? '35000',
    );
  }

  onModuleInit(): void {
    if (!this.habilitado) return;

    this.intervalo = setInterval(() => {
      void this.processarLote().catch((erro) =>
        this.logger.error('Falha ao reprocessar aprovações pendentes', erro),
      );
    }, this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  async processarLote(): Promise<void> {
    const pendentes = await this.orcamentos.reivindicarAprovacoesPendentes(
      this.posseMs,
    );
    for (const orcamento of pendentes) {
      if (!orcamento.id) continue;
      try {
        await this.aprovarOrcamento.reprocessarPendente(orcamento.id);
      } catch (erro) {
        // A posse do orçamento segue valendo: ele só volta ao lote ao expirar.
        this.registrarFalha(orcamento, erro);
      }
    }
  }

  private registrarFalha(orcamento: Orcamento, erro: unknown): void {
    this.logger.error(
      serializarFalhaItemLote(
        {
          processador: ProcessadorAprovacoesPendentesService.name,
          itemId: orcamento.id as string,
          ordemServicoId: orcamento.ordemServicoId,
          rodada: orcamento.rodada,
          correlationId: orcamento.correlationId,
        },
        erro,
      ),
      rastreamentoDoErro(erro),
    );
  }
}
