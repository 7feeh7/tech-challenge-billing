import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { calcularPosseCancelamentoFinanceiroMs } from '@/modules/cobrancas/application/calcular-posse-cobranca';
import type {
  EstornoAutomaticoGateway,
  EstornoAutomaticoRegistro,
} from '@/modules/cobrancas/application/ports/estorno-automatico.gateway';
import { ESTORNO_AUTOMATICO_GATEWAY } from '@/modules/cobrancas/application/ports/tokens';
import { ExecutarEstornoAutomaticoService } from '@/modules/cobrancas/application/services/executar-estorno-automatico.service';
import {
  rastreamentoDoErro,
  serializarFalhaItemLote,
} from '@/shared/observability/falha-item-lote';
import type {
  OperacaoFinanceiraGateway,
  OperacaoFinanceiraRegistro,
} from '../../application/ports/operacao-financeira.gateway';
import { OPERACAO_FINANCEIRA_GATEWAY } from '../../application/ports/tokens';
import { ExecutarCancelamentoFinanceiroService } from '../../application/services/executar-cancelamento-financeiro.service';
import { ExecutarConsultaSituacaoFinanceiroService } from '../../application/services/executar-consulta-situacao-financeiro.service';

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
  private readonly atrasoNovaTentativaMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly executarCancelamento: ExecutarCancelamentoFinanceiroService,
    private readonly executarConsulta: ExecutarConsultaSituacaoFinanceiroService,
    @Inject(OPERACAO_FINANCEIRA_GATEWAY)
    private readonly operacoes: OperacaoFinanceiraGateway,
    private readonly executarEstornoAutomatico: ExecutarEstornoAutomaticoService,
    @Inject(ESTORNO_AUTOMATICO_GATEWAY)
    private readonly estornosAutomaticos: EstornoAutomaticoGateway,
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
    const mpRetryBackoff = Number(
      this.config.get<string>('CANCELAMENTO_FINANCEIRO_RETRY_MP_MS') ?? '30000',
    );
    this.atrasoNovaTentativaMs = mpRetryBackoff;
    const overrideRaw =
      this.config.get<string>('CANCELAMENTO_FINANCEIRO_REIVINDICACAO_MS') ??
      this.config.get<string>('COBRANCA_REIVINDICACAO_MS');
    const override = overrideRaw ? Number(overrideRaw) : undefined;
    this.posseMs = calcularPosseCancelamentoFinanceiroMs({
      lote: this.lote,
      mpRequestTimeoutMs: mpTimeout,
      mpRetryBackoffMs: mpRetryBackoff,
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
    await this.processarOperacoes();
    await this.processarEstornosAutomaticos();
  }

  private async processarOperacoes(): Promise<void> {
    const reivindicadas = await this.operacoes.reivindicarEmAndamento(
      this.lote,
      this.posseMs,
    );
    // Cada operação é isolada: a falha de uma não interrompe as demais e ela
    // continua EM_ANDAMENTO, de modo que a resposta ao OS ainda será enviada.
    for (const operacao of reivindicadas) {
      try {
        await this.executarOperacao(operacao);
      } catch (erro) {
        await this.liberarOperacaoParaNovaTentativa(operacao, erro);
      }
    }
  }

  private async executarOperacao(
    operacao: OperacaoFinanceiraRegistro,
  ): Promise<void> {
    if (operacao.tipo === 'CONSULTA_SITUACAO_FINANCEIRA') {
      await this.executarConsulta.executar(operacao.id);
      return;
    }
    await this.executarCancelamento.executar(operacao.id);
  }

  private async liberarOperacaoParaNovaTentativa(
    operacao: OperacaoFinanceiraRegistro,
    erro: unknown,
  ): Promise<void> {
    this.logger.error(
      serializarFalhaItemLote(
        {
          processador: ProcessadorOperacoesFinanceirasService.name,
          itemId: operacao.id,
          ordemServicoId: operacao.ordemServicoId,
          rodada: operacao.rodada,
          correlationId: operacao.correlationId,
        },
        erro,
      ),
      rastreamentoDoErro(erro),
    );
    try {
      await this.operacoes.adiarProcessamento(
        operacao.id,
        new Date(Date.now() + this.atrasoNovaTentativaMs),
      );
    } catch (erroAoAdiar) {
      // Sem a espera, a posse da reivindicação ainda impede o reprocessamento
      // imediato; ela expira e a operação volta ao lote.
      this.logger.error(
        serializarFalhaItemLote(
          {
            processador: ProcessadorOperacoesFinanceirasService.name,
            itemId: operacao.id,
            ordemServicoId: operacao.ordemServicoId,
            rodada: operacao.rodada,
            correlationId: operacao.correlationId,
          },
          erroAoAdiar,
        ),
        rastreamentoDoErro(erroAoAdiar),
      );
    }
  }

  private async processarEstornosAutomaticos(): Promise<void> {
    const reivindicados = await this.estornosAutomaticos.reivindicarEmAndamento(
      this.lote,
      this.posseMs,
    );
    for (const estorno of reivindicados) {
      try {
        await this.executarEstornoAutomatico.processar(estorno);
      } catch (erro) {
        await this.liberarEstornoParaNovaTentativa(estorno, erro);
      }
    }
  }

  private async liberarEstornoParaNovaTentativa(
    estorno: EstornoAutomaticoRegistro,
    erro: unknown,
  ): Promise<void> {
    this.logger.error(
      serializarFalhaItemLote(
        {
          processador: ProcessadorOperacoesFinanceirasService.name,
          itemId: estorno.id,
        },
        erro,
      ),
      rastreamentoDoErro(erro),
    );
    try {
      await this.executarEstornoAutomatico.adiarNovaTentativa(estorno.id);
    } catch (erroAoAdiar) {
      this.logger.error(
        serializarFalhaItemLote(
          {
            processador: ProcessadorOperacoesFinanceirasService.name,
            itemId: estorno.id,
          },
          erroAoAdiar,
        ),
        rastreamentoDoErro(erroAoAdiar),
      );
    }
  }
}
