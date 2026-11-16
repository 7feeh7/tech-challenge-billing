import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { CobrancaGateway } from '../../application/ports/cobranca.gateway';
import type { Cobranca } from '../../domain/entities/cobranca.entity';
import { PrismaCobrancaMapper } from './prisma-cobranca.mapper';

@Injectable()
export class PrismaCobrancaGateway implements CobrancaGateway {
  constructor(private readonly prisma: PrismaService) {}

  async criar(
    contexto: ContextoTransacao,
    cobranca: Cobranca,
  ): Promise<Cobranca> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.cobranca.create({
      data: PrismaCobrancaMapper.toPersistence(cobranca),
    });
    return PrismaCobrancaMapper.toDomain(raw);
  }

  async buscarPorOrcamentoId(orcamentoId: string): Promise<Cobranca | null> {
    const raw = await this.prisma.cobranca.findUnique({
      where: { orcamentoId },
    });
    return raw ? PrismaCobrancaMapper.toDomain(raw) : null;
  }
}
