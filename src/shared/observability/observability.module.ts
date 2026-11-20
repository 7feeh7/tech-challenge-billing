import { Global, Module } from '@nestjs/common';
import { JsonLoggerService } from './json-logger.service';
import { PrismaPendenciaFinanceiraMonitorGateway } from './prisma-pendencia-financeira-monitor.gateway';
import { PENDENCIA_FINANCEIRA_MONITOR_GATEWAY } from './tokens';

@Global()
@Module({
  providers: [
    JsonLoggerService,
    PrismaPendenciaFinanceiraMonitorGateway,
    {
      provide: PENDENCIA_FINANCEIRA_MONITOR_GATEWAY,
      useExisting: PrismaPendenciaFinanceiraMonitorGateway,
    },
  ],
  exports: [JsonLoggerService, PENDENCIA_FINANCEIRA_MONITOR_GATEWAY],
})
export class ObservabilityModule {}
