import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/shared/database/prisma.service';
import { METRICA_LOG, serializarMetricaLog } from './metrica-log';
import type {
  PendenciaFinanceiraMonitorGateway,
  RegistrarPendenciaFinanceiraMonitorInput,
} from './pendencia-financeira-monitor.gateway';

@Injectable()
export class PrismaPendenciaFinanceiraMonitorGateway
  implements PendenciaFinanceiraMonitorGateway
{
  private readonly logger = new Logger(
    PrismaPendenciaFinanceiraMonitorGateway.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  async registrar(
    input: RegistrarPendenciaFinanceiraMonitorInput,
  ): Promise<void> {
    await this.prisma.pendenciaFinanceiraMonitoramento.create({
      data: {
        id: randomUUID(),
        tipo: input.tipo,
        operacaoId: input.operacaoId ?? null,
        cobrancaId: input.cobrancaId ?? null,
        ordemServicoId: input.ordemServicoId,
        rodada: input.rodada,
        correlationId: input.correlationId,
        motivo: input.motivo ?? null,
      },
    });
    this.logger.log(
      serializarMetricaLog(METRICA_LOG.SITUACAO_FINANCEIRA_INDETERMINADA, {
        ordemServicoId: input.ordemServicoId,
        rodada: input.rodada,
        correlationId: input.correlationId,
        operacaoId: input.operacaoId,
        cobrancaId: input.cobrancaId,
        motivo: input.motivo,
      }),
    );
  }

  async resolverPorOperacao(operacaoId: string): Promise<void> {
    await this.prisma.pendenciaFinanceiraMonitoramento.updateMany({
      where: { operacaoId, resolvidoEm: null },
      data: { resolvidoEm: new Date() },
    });
  }
}
