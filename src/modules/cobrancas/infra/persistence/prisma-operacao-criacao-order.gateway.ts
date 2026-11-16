import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  OperacaoCriacaoOrderGateway,
  OperacaoCriacaoOrderRegistro,
} from '../../application/ports/operacao-criacao-order.gateway';

@Injectable()
export class PrismaOperacaoCriacaoOrderGateway
  implements OperacaoCriacaoOrderGateway
{
  constructor(private readonly prisma: PrismaService) {}

  async obterPorCobrancaId(
    cobrancaId: string,
  ): Promise<OperacaoCriacaoOrderRegistro | null> {
    const raw = await this.prisma.operacaoCriacaoOrder.findUnique({
      where: { cobrancaId },
    });
    return raw
      ? {
          id: raw.id,
          cobrancaId: raw.cobrancaId,
          chaveIdempotencia: raw.chaveIdempotencia,
          situacao: raw.situacao,
        }
      : null;
  }

  async garantirEmAndamento(
    contexto: ContextoTransacao,
    cobrancaId: string,
    chaveIdempotencia: string,
  ): Promise<OperacaoCriacaoOrderRegistro> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.operacaoCriacaoOrder.upsert({
      where: { cobrancaId },
      create: {
        cobrancaId,
        chaveIdempotencia,
        situacao: 'EM_ANDAMENTO',
      },
      update: {},
    });
    return {
      id: raw.id,
      cobrancaId: raw.cobrancaId,
      chaveIdempotencia: raw.chaveIdempotencia,
      situacao: raw.situacao,
    };
  }

  async marcarConcluida(
    contexto: ContextoTransacao,
    cobrancaId: string,
  ): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.operacaoCriacaoOrder.update({
      where: { cobrancaId },
      data: { situacao: 'CONCLUIDA' },
    });
  }

  async garantirReemissaoEmAndamento(
    contexto: ContextoTransacao,
    cobrancaId: string,
  ): Promise<string> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const existente = await cliente.operacaoCriacaoOrder.findUnique({
      where: { cobrancaId },
    });

    if (existente?.situacao === 'EM_ANDAMENTO') {
      return existente.chaveIdempotencia;
    }

    const novaChave = randomUUID();
    if (existente) {
      await cliente.operacaoCriacaoOrder.update({
        where: { cobrancaId },
        data: {
          chaveIdempotencia: novaChave,
          situacao: 'EM_ANDAMENTO',
        },
      });
      return novaChave;
    }

    await cliente.operacaoCriacaoOrder.create({
      data: {
        cobrancaId,
        chaveIdempotencia: novaChave,
        situacao: 'EM_ANDAMENTO',
      },
    });
    return novaChave;
  }
}
