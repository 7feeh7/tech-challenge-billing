import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { OUTBOX_GATEWAY } from '@/shared/messaging/application/ports/tokens';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import type { AvisoWebhookGateway } from './application/ports/aviso-webhook.gateway';
import type { CobrancaGateway } from './application/ports/cobranca.gateway';
import type { MercadoPagoGateway } from './application/ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from './application/ports/operacao-criacao-order.gateway';
import type { OrderMercadoPagoGateway } from './application/ports/order-mercado-pago.gateway';
import type { TentativaRecusaGateway } from './application/ports/tentativa-recusa.gateway';
import {
  AVISO_WEBHOOK_GATEWAY,
  COBRANCA_GATEWAY,
  MERCADO_PAGO_GATEWAY,
  OPERACAO_CRIACAO_ORDER_GATEWAY,
  ORDER_MERCADO_PAGO_GATEWAY,
  TENTATIVA_RECUSA_GATEWAY,
} from './application/ports/tokens';
import { ConciliarCobrancaService } from './application/services/conciliar-cobranca.service';
import { CriarOrderMercadoPagoService } from './application/services/criar-order-mercado-pago.service';
import { ListarCobrancasUseCase } from './application/use-cases/listar-cobrancas.use-case';
import { ProcessarNotificacaoMercadoPagoUseCase } from './application/use-cases/processar-notificacao-mercado-pago.use-case';
import { CobrancasController } from './infra/http/controllers/cobrancas.controller';
import { FetchMercadoPagoGateway } from './infra/http/fetch-mercado-pago.gateway';
import { ProcessadorCobrancasIntencaoService } from './infra/jobs/processador-cobrancas-intencao.service';
import { ProcessadorConciliacaoCobrancasService } from './infra/jobs/processador-conciliacao-cobrancas.service';
import { PrismaAvisoWebhookGateway } from './infra/persistence/prisma-aviso-webhook.gateway';
import { PrismaCobrancaGateway } from './infra/persistence/prisma-cobranca.gateway';
import { PrismaOperacaoCriacaoOrderGateway } from './infra/persistence/prisma-operacao-criacao-order.gateway';
import { PrismaOrderMercadoPagoGateway } from './infra/persistence/prisma-order-mercado-pago.gateway';
import { PrismaTentativaRecusaGateway } from './infra/persistence/prisma-tentativa-recusa.gateway';

@Module({
  imports: [MensageriaModule],
  controllers: [CobrancasController],
  providers: [
    PrismaCobrancaGateway,
    PrismaOrderMercadoPagoGateway,
    PrismaOperacaoCriacaoOrderGateway,
    PrismaAvisoWebhookGateway,
    PrismaTentativaRecusaGateway,
    FetchMercadoPagoGateway,
    { provide: COBRANCA_GATEWAY, useExisting: PrismaCobrancaGateway },
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
      provide: CriarOrderMercadoPagoService,
      useFactory: (
        uow: UnitOfWork,
        cobrancas: CobrancaGateway,
        operacoes: OperacaoCriacaoOrderGateway,
        orders: OrderMercadoPagoGateway,
        mp: MercadoPagoGateway,
        outbox: OutboxGateway,
        config: ConfigService,
      ) =>
        new CriarOrderMercadoPagoService(
          uow,
          cobrancas,
          operacoes,
          orders,
          mp,
          outbox,
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
        ConfigService,
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
        operacoes: OperacaoCriacaoOrderGateway,
        outbox: OutboxGateway,
        config: ConfigService,
      ) =>
        new ConciliarCobrancaService(
          uow,
          cobrancas,
          orders,
          mp,
          tentativas,
          operacoes,
          outbox,
          config.get<string>('MP_PAYER_EMAIL')?.trim() ??
            'comprador@example.com',
        ),
      inject: [
        UNIT_OF_WORK,
        COBRANCA_GATEWAY,
        ORDER_MERCADO_PAGO_GATEWAY,
        MERCADO_PAGO_GATEWAY,
        TENTATIVA_RECUSA_GATEWAY,
        OPERACAO_CRIACAO_ORDER_GATEWAY,
        OUTBOX_GATEWAY,
        ConfigService,
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
  ],
  exports: [
    COBRANCA_GATEWAY,
    ProcessarNotificacaoMercadoPagoUseCase,
    ConciliarCobrancaService,
    MERCADO_PAGO_GATEWAY,
  ],
})
export class CobrancasModule {}
