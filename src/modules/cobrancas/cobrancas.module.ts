import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BloqueioCriacaoCobrancaGateway } from '@/modules/cancelamento-financeiro/application/ports/bloqueio-criacao-cobranca.gateway';
import type { PendenciaEstornoGateway } from '@/modules/cancelamento-financeiro/application/ports/pendencia-estorno.gateway';
import {
  BLOQUEIO_CRIACAO_COBRANCA_GATEWAY,
  PENDENCIA_ESTORNO_GATEWAY,
} from '@/modules/cancelamento-financeiro/application/ports/tokens';
import { CancelamentoFinanceiroModule } from '@/modules/cancelamento-financeiro/cancelamento-financeiro.module';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { OUTBOX_GATEWAY } from '@/shared/messaging/application/ports/tokens';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import { calcularTempoOperacaoFinanceiraMesmaReivindicacaoMs } from './application/calcular-posse-cobranca';
import type { AvisoWebhookGateway } from './application/ports/aviso-webhook.gateway';
import type { CobrancaGateway } from './application/ports/cobranca.gateway';
import type { EstornoAutomaticoGateway } from './application/ports/estorno-automatico.gateway';
import type { MercadoPagoGateway } from './application/ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from './application/ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from './application/ports/order-mercado-pago.gateway';
import type { TentativaRecusaGateway } from './application/ports/tentativa-recusa.gateway';
import {
  AVISO_WEBHOOK_GATEWAY,
  COBRANCA_GATEWAY,
  ESTORNO_AUTOMATICO_GATEWAY,
  MERCADO_PAGO_GATEWAY,
  OPERACAO_CRIACAO_ORDER_GATEWAY,
  ORDER_MERCADO_PAGO_GATEWAY,
  TENTATIVA_RECUSA_GATEWAY,
} from './application/ports/tokens';
import { ConciliarCobrancaService } from './application/services/conciliar-cobranca.service';
import { CriarOrderMercadoPagoService } from './application/services/criar-order-mercado-pago.service';
import { ExecutarEstornoAutomaticoService } from './application/services/executar-estorno-automatico.service';
import { ExpirarCobrancaService } from './application/services/expirar-cobranca.service';
import { ReemitirOrderMercadoPagoService } from './application/services/reemitir-order-mercado-pago.service';
import { RegistrarSegundoPagamentoService } from './application/services/registrar-segundo-pagamento.service';
import { TratarPagamentoTardioService } from './application/services/tratar-pagamento-tardio.service';
import { ListarCobrancasUseCase } from './application/use-cases/listar-cobrancas.use-case';
import { ProcessarNotificacaoMercadoPagoUseCase } from './application/use-cases/processar-notificacao-mercado-pago.use-case';
import { CobrancasController } from './infra/http/controllers/cobrancas.controller';
import { FetchMercadoPagoGateway } from './infra/http/fetch-mercado-pago.gateway';
import { ProcessadorCobrancasIntencaoService } from './infra/jobs/processador-cobrancas-intencao.service';
import { ProcessadorConciliacaoCobrancasService } from './infra/jobs/processador-conciliacao-cobrancas.service';
import { ProcessadorExpiracaoCobrancasService } from './infra/jobs/processador-expiracao-cobrancas.service';
import { PrismaAvisoWebhookGateway } from './infra/persistence/prisma-aviso-webhook.gateway';
import { PrismaCobrancaGateway } from './infra/persistence/prisma-cobranca.gateway';
import { PrismaEstornoAutomaticoGateway } from './infra/persistence/prisma-estorno-automatico.gateway';
import { PrismaOperacaoCriacaoOrderGateway } from './infra/persistence/prisma-operacao-criacao-order.gateway';
import { PrismaOrderMercadoPagoGateway } from './infra/persistence/prisma-order-mercado-pago.gateway';
import { PrismaTentativaRecusaGateway } from './infra/persistence/prisma-tentativa-recusa.gateway';

@Module({
  imports: [MensageriaModule, forwardRef(() => CancelamentoFinanceiroModule)],
  controllers: [CobrancasController],
  providers: [
    PrismaCobrancaGateway,
    PrismaOrderMercadoPagoGateway,
    PrismaOperacaoCriacaoOrderGateway,
    PrismaAvisoWebhookGateway,
    PrismaTentativaRecusaGateway,
    PrismaEstornoAutomaticoGateway,
    FetchMercadoPagoGateway,
    { provide: COBRANCA_GATEWAY, useExisting: PrismaCobrancaGateway },
    {
      provide: ESTORNO_AUTOMATICO_GATEWAY,
      useExisting: PrismaEstornoAutomaticoGateway,
    },
    {
      provide: ORDER_MERCADO_PAGO_GATEWAY,
      useExisting: PrismaOrderMercadoPagoGateway,
    },
    {
      provide: OPERACAO_CRIACAO_ORDER_GATEWAY,
      useExisting: PrismaOperacaoCriacaoOrderGateway,
    },
    { provide: AVISO_WEBHOOK_GATEWAY, useExisting: PrismaAvisoWebhookGateway },
    {
      provide: TENTATIVA_RECUSA_GATEWAY,
      useExisting: PrismaTentativaRecusaGateway,
    },
    { provide: MERCADO_PAGO_GATEWAY, useExisting: FetchMercadoPagoGateway },
    {
      provide: ReemitirOrderMercadoPagoService,
      useFactory: (
        uow: UnitOfWork,
        cobrancas: CobrancaGateway,
        operacoes: OperacaoCriacaoOrderGateway,
        orders: OrderMercadoPagoGateway,
        mp: MercadoPagoGateway,
        outbox: OutboxGateway,
        bloqueios: BloqueioCriacaoCobrancaGateway,
        config: ConfigService,
      ) =>
        new ReemitirOrderMercadoPagoService(
          uow,
          cobrancas,
          operacoes,
          orders,
          mp,
          outbox,
          bloqueios,
          config.get<string>('MP_PAYER_EMAIL')?.trim() ??
            'comprador@example.com',
        ),
      inject: [
        UNIT_OF_WORK,
        COBRANCA_GATEWAY,
        OPERACAO_CRIACAO_ORDER_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        OUTBOX_GATEWAY,
        BLOQUEIO_CRIACAO_COBRANCA_GATEWAY,
        ConfigService,
      ],
    },
    {
      provide: CriarOrderMercadoPagoService,
      useFactory: (
        uow: UnitOfWork,
        cobrancas: CobrancaGateway,
        operacoes: OperacaoCriacaoOrderGateway,
        orders: OrderMercadoPagoGateway,
        mp: MercadoPagoGateway,
        outbox: OutboxGateway,
        bloqueios: BloqueioCriacaoCobrancaGateway,
        config: ConfigService,
      ) =>
        new CriarOrderMercadoPagoService(
          uow,
          cobrancas,
          operacoes,
          orders,
          mp,
          outbox,
          bloqueios,
          config.get<string>('MP_PAYER_EMAIL')?.trim() ??
            'comprador@example.com',
        ),
      inject: [
        UNIT_OF_WORK,
        COBRANCA_GATEWAY,
        OPERACAO_CRIACAO_ORDER_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        OUTBOX_GATEWAY,
        BLOQUEIO_CRIACAO_COBRANCA_GATEWAY,
        ConfigService,
      ],
    },
    {
      provide: ExecutarEstornoAutomaticoService,
      useFactory: (
        uow: UnitOfWork,
        estornos: EstornoAutomaticoGateway,
        cobrancas: CobrancaGateway,
        orders: OrderMercadoPagoGateway,
        pendencias: PendenciaEstornoGateway,
        mp: MercadoPagoGateway,
        outbox: OutboxGateway,
        config: ConfigService,
      ) => {
        const atrasoRetryMs = Number(
          config.get<string>('CANCELAMENTO_FINANCEIRO_RETRY_MP_MS') ?? '30000',
        );
        return new ExecutarEstornoAutomaticoService(
          uow,
          estornos,
          cobrancas,
          orders,
          pendencias,
          mp,
          outbox,
          {
            maxTentativas: Number(
              config.get<string>('CANCELAMENTO_FINANCEIRO_MAX_TENTATIVAS_MP') ??
                '5',
            ),
            atrasoRetryMs,
            posseMs: calcularTempoOperacaoFinanceiraMesmaReivindicacaoMs({
              mpRequestTimeoutMs: Number(
                config.get<string>('MP_REQUEST_TIMEOUT_MS') ?? '30000',
              ),
              mpRetryBackoffMs: atrasoRetryMs,
            }),
          },
        );
      },
      inject: [
        UNIT_OF_WORK,
        ESTORNO_AUTOMATICO_GATEWAY,
        COBRANCA_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        PENDENCIA_ESTORNO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        OUTBOX_GATEWAY,
        ConfigService,
      ],
    },
    {
      provide: RegistrarSegundoPagamentoService,
      useFactory: (
        estornos: EstornoAutomaticoGateway,
        orders: OrderMercadoPagoGateway,
        outbox: OutboxGateway,
        executarEstorno: ExecutarEstornoAutomaticoService,
      ) =>
        new RegistrarSegundoPagamentoService(
          estornos,
          orders,
          outbox,
          executarEstorno,
        ),
      inject: [
        ESTORNO_AUTOMATICO_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        OUTBOX_GATEWAY,
        ExecutarEstornoAutomaticoService,
      ],
    },
    {
      provide: TratarPagamentoTardioService,
      useFactory: (
        uow: UnitOfWork,
        cobrancas: CobrancaGateway,
        estornos: EstornoAutomaticoGateway,
        executarEstorno: ExecutarEstornoAutomaticoService,
      ) =>
        new TratarPagamentoTardioService(
          uow,
          cobrancas,
          estornos,
          executarEstorno,
        ),
      inject: [
        UNIT_OF_WORK,
        COBRANCA_GATEWAY,
        ESTORNO_AUTOMATICO_GATEWAY,
        ExecutarEstornoAutomaticoService,
      ],
    },
    {
      provide: ExpirarCobrancaService,
      useFactory: (
        uow: UnitOfWork,
        cobrancas: CobrancaGateway,
        orders: OrderMercadoPagoGateway,
        mp: MercadoPagoGateway,
        outbox: OutboxGateway,
        pagamentoTardio: TratarPagamentoTardioService,
        conciliar: ConciliarCobrancaService,
      ) =>
        new ExpirarCobrancaService(
          uow,
          cobrancas,
          orders,
          mp,
          outbox,
          pagamentoTardio,
          conciliar,
        ),
      inject: [
        UNIT_OF_WORK,
        COBRANCA_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        OUTBOX_GATEWAY,
        TratarPagamentoTardioService,
        ConciliarCobrancaService,
      ],
    },
    {
      provide: ConciliarCobrancaService,
      useFactory: (
        uow: UnitOfWork,
        cobrancas: CobrancaGateway,
        orders: OrderMercadoPagoGateway,
        mp: MercadoPagoGateway,
        tentativas: TentativaRecusaGateway,
        outbox: OutboxGateway,
        reemitir: ReemitirOrderMercadoPagoService,
        pagamentoTardio: TratarPagamentoTardioService,
        segundoPagamento: RegistrarSegundoPagamentoService,
      ) =>
        new ConciliarCobrancaService(
          uow,
          cobrancas,
          orders,
          mp,
          tentativas,
          outbox,
          reemitir,
          pagamentoTardio,
          segundoPagamento,
        ),
      inject: [
        UNIT_OF_WORK,
        COBRANCA_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        TENTATIVA_RECUSA_GATEWAY,
        OUTBOX_GATEWAY,
        ReemitirOrderMercadoPagoService,
        TratarPagamentoTardioService,
        RegistrarSegundoPagamentoService,
      ],
    },
    {
      provide: ProcessarNotificacaoMercadoPagoUseCase,
      useFactory: (
        uow: UnitOfWork,
        cobrancas: CobrancaGateway,
        avisos: AvisoWebhookGateway,
        conciliar: ConciliarCobrancaService,
      ) =>
        new ProcessarNotificacaoMercadoPagoUseCase(
          uow,
          cobrancas,
          avisos,
          conciliar,
        ),
      inject: [
        UNIT_OF_WORK,
        COBRANCA_GATEWAY,
        AVISO_WEBHOOK_GATEWAY,
        ConciliarCobrancaService,
      ],
    },
    {
      provide: ListarCobrancasUseCase,
      useFactory: (cobrancas: CobrancaGateway) =>
        new ListarCobrancasUseCase(cobrancas),
      inject: [COBRANCA_GATEWAY],
    },
    ProcessadorCobrancasIntencaoService,
    ProcessadorConciliacaoCobrancasService,
    ProcessadorExpiracaoCobrancasService,
  ],
  exports: [
    COBRANCA_GATEWAY,
    ORDER_MERCADO_PAGO_GATEWAY,
    OPERACAO_CRIACAO_ORDER_GATEWAY,
    ESTORNO_AUTOMATICO_GATEWAY,
    ExecutarEstornoAutomaticoService,
    ProcessarNotificacaoMercadoPagoUseCase,
    ConciliarCobrancaService,
    MERCADO_PAGO_GATEWAY,
  ],
})
export class CobrancasModule {}
