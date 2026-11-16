import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { BloqueioCriacaoCobrancaGateway } from '../../application/ports/bloqueio-criacao-cobranca.gateway';

@Injectable()
export class PrismaBloqueioCriacaoCobrancaGateway
  implements BloqueioCriacaoCobrancaGateway
{
  constructor(private readonly prisma: PrismaService) {}

  async existe(ordemServicoId: string, rodada: number): Promise<boolean> {
    const registro = await this.prisma.bloqueioCriacaoCobranca.findUnique({
      where: {
        ordemServicoId_rodada: { ordemServicoId, rodada },
      },
    });
    return !!registro;
  }

  async garantir(
    contexto: ContextoTransacao,
    ordemServicoId: string,
    rodada: number,
    motivo?: string | null,
  ): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.bloqueioCriacaoCobranca.upsert({
      where: {
        ordemServicoId_rodada: { ordemServicoId, rodada },
      },
      create: {
        ordemServicoId,
        rodada,
        motivo: motivo ?? null,
      },
      update: {
        motivo: motivo ?? undefined,
      },
    });
  }
}
