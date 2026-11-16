import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/shared/database/prisma.service';
import type {
  PendenciaFinanceiraMonitorGateway,
  RegistrarPendenciaFinanceiraMonitorInput,
} from './pendencia-financeira-monitor.gateway';

const METRICA_SITUACAO_FINANCEIRA_INDETERMINADA =
  'billing.situacao_financeira_indeterminada';

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
      JSON.stringify({
        metric: METRICA_SITUACAO_FINANCEIRA_INDETERMINADA,
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
