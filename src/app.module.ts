import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { OwnershipGuard } from './modules/auth/guards/ownership.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { CobrancasModule } from './modules/cobrancas/cobrancas.module';
import { HealthModule } from './modules/health/health.module';
import { OrcamentosModule } from './modules/orcamentos/orcamentos.module';
import { WebhookMercadoPagoModule } from './modules/webhook-mercado-pago/webhook-mercado-pago.module';
import { PrismaModule } from './shared/database/prisma.module';
import { DomainExceptionFilter } from './shared/filters/domain-exception.filter';
import { ObservabilityModule } from './shared/observability/observability.module';

@Module({
  imports: [
    ObservabilityModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    CobrancasModule,
    WebhookMercadoPagoModule,
    OrcamentosModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: OwnershipGuard },
  ],
})
export class AppModule {}
