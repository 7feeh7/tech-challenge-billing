import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { HealthModule } from './modules/health/health.module';
import { WebhookMercadoPagoModule } from './modules/webhook-mercado-pago/webhook-mercado-pago.module';
import { PrismaModule } from './shared/database/prisma.module';
import { DomainExceptionFilter } from './shared/filters/domain-exception.filter';
import { ObservabilityModule } from './shared/observability/observability.module';

@Module({
  imports: [
    ObservabilityModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'prova-tecnica/.env'],
    }),
    PrismaModule,
    HealthModule,
    WebhookMercadoPagoModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
  ],
})
export class AppModule {}
