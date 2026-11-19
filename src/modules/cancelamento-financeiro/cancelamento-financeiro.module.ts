import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import type { EstornoAutomaticoGateway } from '@/modules/cobrancas/application/ports/estorno-automatico.gateway';
import type { MercadoPagoGateway } from '@/modules/cobrancas/application/ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '@/modules/cobrancas/application/ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from '@/modules/cobrancas/application/ports/order-mercado-pago.gateway';
import {
  COBRANCA_GATEWAY,
  ESTORNO_AUTOMATICO_GATEWAY,
  MERCADO_PAGO_GATEWAY,
  OPERACAO_CRIACAO_ORDER_GATEWAY,
  ORDER_MERCADO_PAGO_GATEWAY,
} from '@/modules/cobrancas/application/ports/tokens';
import { CobrancasModule } from '@/modules/cobrancas/cobrancas.module';
import type { OrcamentoGateway } from '@/modules/orcamentos/application/ports/orcamento.gateway';
import { ORCAMENTO_GATEWAY } from '@/modules/orcamentos/application/ports/tokens';
import { PrismaOrcamentoGateway } from '@/modules/orcamentos/infra/persistence/prisma-orcamento.gateway';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '@/shared/database/unit-of-work.port';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  MENSAGEM_PROCESSADA_GATEWAY,
  OUTBOX_GATEWAY,
} from '@/shared/messaging/application/ports/tokens';
import {
  PROCESSADOR_CANCELAR_FINANCEIRO,
  PROCESSADOR_CONSULTAR_SITUACAO_FINANCEIRO,
} from '@/shared/messaging/infra/consumo/consumidor-fila-billing.service';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import { ObservabilityModule } from '@/shared/observability/observability.module';
import type { PendenciaFinanceiraMonitorGateway } from '@/shared/observability/pendencia-financeira-monitor.gateway';
import { PENDENCIA_FINANCEIRA_MONITOR_GATEWAY } from '@/shared/observability/tokens';
import {
  BLOQUEIO_CRIACAO_COBRANCA_GATEWAY,
  OPERACAO_FINANCEIRA_GATEWAY,
  PENDENCIA_ESTORNO_GATEWAY,
} from './application/ports/tokens';
import { ExecutarCancelamentoFinanceiroService } from './application/services/executar-cancelamento-financeiro.service';
import { ExecutarConsultaSituacaoFinanceiroService } from './application/services/executar-consulta-situacao-financeiro.service';
import { ProcessarCancelarFinanceiroUseCase } from './application/use-cases/processar-cancelar-financeiro.use-case';
import { ProcessarConsultarSituacaoFinanceiroUseCase } from './application/use-cases/processar-consultar-situacao-financeiro.use-case';
import { ResolverPendenciaEstornoUseCase } from './application/use-cases/resolver-pendencia-estorno.use-case';
import { PendenciasEstornoController } from './infra/http/controllers/pendencias-estorno.controller';
import { ProcessadorOperacoesFinanceirasService } from './infra/jobs/processador-operacoes-financeiras.service';
import { PrismaBloqueioCriacaoCobrancaGateway } from './infra/persistence/prisma-bloqueio-criacao-cobranca.gateway';
import { PrismaOperacaoFinanceiraGateway } from './infra/persistence/prisma-operacao-financeira.gateway';
import { PrismaPendenciaEstornoGateway } from './infra/persistence/prisma-pendencia-estorno.gateway';

@Module({
  imports: [
    MensageriaModule,
    ObservabilityModule,
    forwardRef(() => CobrancasModule),
  ],
  controllers: [PendenciasEstornoController],
  providers: [
    PrismaBloqueioCriacaoCobrancaGateway,
    PrismaOperacaoFinanceiraGateway,
    PrismaPendenciaEstornoGateway,
    PrismaOrcamentoGateway,
    { provide: ORCAMENTO_GATEWAY, useExisting: PrismaOrcamentoGateway },
    {
      provide: BLOQUEIO_CRIACAO_COBRANCA_GATEWAY,
      useExisting: PrismaBloqueioCriacaoCobrancaGateway,
    },
    {
      provide: OPERACAO_FINANCEIRA_GATEWAY,
      useExisting: PrismaOperacaoFinanceiraGateway,
    },
    {
      provide: PENDENCIA_ESTORNO_GATEWAY,
      useExisting: PrismaPendenciaEstornoGateway,
    },
    {
      provide: ProcessarCancelarFinanceiroUseCase,
      useFactory: (
        uow: UnitOfWork,
        bloqueios: PrismaBloqueioCriacaoCobrancaGateway,
        operacoes: PrismaOperacaoFinanceiraGateway,
        mensagens: MensagemProcessadaGateway,
      ) =>
        new ProcessarCancelarFinanceiroUseCase(
          uow,
          bloqueios,
          operacoes,
          mensagens,
        ),
      inject: [
        UNIT_OF_WORK,
        BLOQUEIO_CRIACAO_COBRANCA_GATEWAY,
        OPERACAO_FINANCEIRA_GATEWAY,
        MENSAGEM_PROCESSADA_GATEWAY,
      ],
    },
    {
      provide: PROCESSADOR_CANCELAR_FINANCEIRO,
      useExisting: ProcessarCancelarFinanceiroUseCase,
    },
    {
      provide: ProcessarConsultarSituacaoFinanceiroUseCase,
      useFactory: (
        uow: UnitOfWork,
        operacoes: PrismaOperacaoFinanceiraGateway,
        mensagens: MensagemProcessadaGateway,
      ) =>
        new ProcessarConsultarSituacaoFinanceiroUseCase(
          uow,
          operacoes,
          mensagens,
        ),
      inject: [
        UNIT_OF_WORK,
        OPERACAO_FINANCEIRA_GATEWAY,
        MENSAGEM_PROCESSADA_GATEWAY,
      ],
    },
    {
      provide: PROCESSADOR_CONSULTAR_SITUACAO_FINANCEIRO,
      useExisting: ProcessarConsultarSituacaoFinanceiroUseCase,
    },
    {
      provide: ExecutarCancelamentoFinanceiroService,
      useFactory: (
        uow: UnitOfWork,
        operacoes: PrismaOperacaoFinanceiraGateway,
        orcamentos: OrcamentoGateway,
        cobrancas: CobrancaGateway,
        operacoesCriacao: OperacaoCriacaoOrderGateway,
        orders: OrderMercadoPagoGateway,
        mp: MercadoPagoGateway,
        pendencias: PrismaPendenciaEstornoGateway,
        outbox: OutboxGateway,
        config: ConfigService,
        estornosAutomaticos: EstornoAutomaticoGateway,
      ) =>
        new ExecutarCancelamentoFinanceiroService(
          uow,
          operacoes,
          orcamentos,
          cobrancas,
          operacoesCriacao,
          orders,
          mp,
          pendencias,
          outbox,
          Number(
            config.get<string>('CANCELAMENTO_FINANCEIRO_AGUARDAR_MS') ??
              '15000',
          ),
          Number(
            config.get<string>('CANCELAMENTO_FINANCEIRO_MAX_TENTATIVAS_MP') ??
              '5',
          ),
          Number(
            config.get<string>('CANCELAMENTO_FINANCEIRO_RETRY_MP_MS') ??
              '30000',
          ),
          estornosAutomaticos,
        ),
      inject: [
        UNIT_OF_WORK,
        OPERACAO_FINANCEIRA_GATEWAY,
        ORCAMENTO_GATEWAY,
        COBRANCA_GATEWAY,
        OPERACAO_CRIACAO_ORDER_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        PENDENCIA_ESTORNO_GATEWAY,
        OUTBOX_GATEWAY,
        ConfigService,
        ESTORNO_AUTOMATICO_GATEWAY,
      ],
    },
    {
      provide: ExecutarConsultaSituacaoFinanceiroService,
      useFactory: (
        uow: UnitOfWork,
        operacoes: PrismaOperacaoFinanceiraGateway,
        cobrancas: CobrancaGateway,
        orders: OrderMercadoPagoGateway,
        mp: MercadoPagoGateway,
        outbox: OutboxGateway,
        monitor: PendenciaFinanceiraMonitorGateway,
        config: ConfigService,
      ) =>
        new ExecutarConsultaSituacaoFinanceiroService(
          uow,
          operacoes,
          cobrancas,
          orders,
          mp,
          outbox,
          monitor,
          Number(
            config.get<string>('CANCELAMENTO_FINANCEIRO_MAX_TENTATIVAS_MP') ??
              '5',
          ),
          Number(
            config.get<string>('CANCELAMENTO_FINANCEIRO_RETRY_MP_MS') ??
              '30000',
          ),
        ),
      inject: [
        UNIT_OF_WORK,
        OPERACAO_FINANCEIRA_GATEWAY,
        COBRANCA_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        OUTBOX_GATEWAY,
        PENDENCIA_FINANCEIRA_MONITOR_GATEWAY,
        ConfigService,
      ],
    },
    {
      provide: ResolverPendenciaEstornoUseCase,
      useFactory: (
        uow: UnitOfWork,
        pendencias: PrismaPendenciaEstornoGateway,
        cobrancas: CobrancaGateway,
        orders: OrderMercadoPagoGateway,
        outbox: OutboxGateway,
        estornosAutomaticos: EstornoAutomaticoGateway,
      ) =>
        new ResolverPendenciaEstornoUseCase(
          uow,
          pendencias,
          cobrancas,
          orders,
          outbox,
          estornosAutomaticos,
        ),
      inject: [
        UNIT_OF_WORK,
        PENDENCIA_ESTORNO_GATEWAY,
        COBRANCA_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        OUTBOX_GATEWAY,
        ESTORNO_AUTOMATICO_GATEWAY,
      ],
    },
    ProcessadorOperacoesFinanceirasService,
  ],
  exports: [
    BLOQUEIO_CRIACAO_COBRANCA_GATEWAY,
    PENDENCIA_ESTORNO_GATEWAY,
    PROCESSADOR_CANCELAR_FINANCEIRO,
    PROCESSADOR_CONSULTAR_SITUACAO_FINANCEIRO,
    ProcessarCancelarFinanceiroUseCase,
    ProcessarConsultarSituacaoFinanceiroUseCase,
  ],
})
export class CancelamentoFinanceiroModule {}
