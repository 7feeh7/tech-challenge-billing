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

  async reiniciarParaNovaOrder(
    contexto: ContextoTransacao,
    cobrancaId: string,
    novaChaveIdempotencia: string,
  ): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.operacaoCriacaoOrder.upsert({
      where: { cobrancaId },
      create: {
        cobrancaId,
        chaveIdempotencia: novaChaveIdempotencia,
        situacao: 'EM_ANDAMENTO',
      },
      update: {
        chaveIdempotencia: novaChaveIdempotencia,
        situacao: 'EM_ANDAMENTO',
      },
    });
  }
}
