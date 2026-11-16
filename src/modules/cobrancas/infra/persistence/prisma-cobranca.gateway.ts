import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import { Prisma } from '@/shared/generated/prisma/client';
import type {
  CobrancaGateway,
  FiltroListarCobrancas,
} from '../../application/ports/cobranca.gateway';
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

  async buscarPorId(id: string): Promise<Cobranca | null> {
    const raw = await this.prisma.cobranca.findUnique({ where: { id } });
    return raw ? PrismaCobrancaMapper.toDomain(raw) : null;
  }

  async buscarPorOrcamentoId(orcamentoId: string): Promise<Cobranca | null> {
    const raw = await this.prisma.cobranca.findUnique({
      where: { orcamentoId },
    });
    return raw ? PrismaCobrancaMapper.toDomain(raw) : null;
  }

  async buscarPorOrdemServicoERodada(
    ordemServicoId: string,
    rodada: number,
  ): Promise<Cobranca | null> {
    const raw = await this.prisma.cobranca.findFirst({
      where: { ordemServicoId, rodada },
      orderBy: { criadoEm: 'desc' },
    });
    return raw ? PrismaCobrancaMapper.toDomain(raw) : null;
  }

  async listar(
    page: number,
    limit: number,
    filtro: FiltroListarCobrancas,
  ): Promise<{ itens: Cobranca[]; total: number }> {
    const where: Prisma.CobrancaWhereInput = {};
    if (filtro.ordemServicoId) {
      where.ordemServicoId = filtro.ordemServicoId;
    }
    if (filtro.clienteId) {
      where.clienteId = filtro.clienteId;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.cobranca.count({ where }),
      this.prisma.cobranca.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total,
      itens: rows.map((r) => PrismaCobrancaMapper.toDomain(r)),
    };
  }

  async atualizar(
    contexto: ContextoTransacao,
    id: string,
    cobranca: Cobranca,
  ): Promise<Cobranca> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.cobranca.update({
      where: { id },
      data: PrismaCobrancaMapper.toUpdate(cobranca),
    });
    return PrismaCobrancaMapper.toDomain(raw);
  }

  async atualizarSePosse(
    contexto: ContextoTransacao,
    id: string,
    cobranca: Cobranca,
    posseAte: Date,
  ): Promise<boolean> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const resultado = await cliente.cobranca.updateMany({
      where: { id, bloqueadoConciliacaoAte: posseAte },
      data: PrismaCobrancaMapper.toUpdate(cobranca),
    });
    return resultado.count === 1;
  }

  async reivindicarIntencoesCriacaoOrder(
    limite: number,
    posseMs: number,
  ): Promise<Cobranca[]> {
    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + posseMs);

    const rows = await this.prisma.$transaction(async (tx) => {
      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cobrancas
        WHERE situacao = 'INTENCAO'
          AND (bloqueado_conciliacao_ate IS NULL OR bloqueado_conciliacao_ate < ${agora})
        ORDER BY criado_em
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED`;

      if (pendentes.length === 0) return [];

      await tx.cobranca.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { bloqueadoConciliacaoAte: bloqueadoAte },
      });

      return tx.cobranca.findMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
      });
    });

    return rows.map((r) => PrismaCobrancaMapper.toDomain(r));
  }

  async reivindicarPendentesConciliacao(
    limite: number,
    posseMs: number,
  ): Promise<Cobranca[]> {
    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + posseMs);

    const rows = await this.prisma.$transaction(async (tx) => {
      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cobrancas
        WHERE situacao = 'PENDENTE'
          AND (bloqueado_conciliacao_ate IS NULL OR bloqueado_conciliacao_ate < ${agora})
        ORDER BY criado_em
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED`;

      if (pendentes.length === 0) return [];

      await tx.cobranca.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { bloqueadoConciliacaoAte: bloqueadoAte },
      });

      return tx.cobranca.findMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
      });
    });

    return rows.map((r) => PrismaCobrancaMapper.toDomain(r));
  }

  async reivindicarPendentesExpiracao(
    limite: number,
    posseMs: number,
  ): Promise<Cobranca[]> {
    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + posseMs);

    const rows = await this.prisma.$transaction(async (tx) => {
      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cobrancas
        WHERE situacao = 'PENDENTE'
          AND prazo_pagamento < ${agora}
          AND (bloqueado_conciliacao_ate IS NULL OR bloqueado_conciliacao_ate < ${agora})
        ORDER BY criado_em
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED`;

      if (pendentes.length === 0) return [];

      await tx.cobranca.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { bloqueadoConciliacaoAte: bloqueadoAte },
      });

      return tx.cobranca.findMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
      });
    });

    return rows.map((r) => PrismaCobrancaMapper.toDomain(r));
  }

  async buscarPorMercadoPagoOrderId(
    mercadoPagoOrderId: string,
  ): Promise<Cobranca | null> {
    const order = await this.prisma.orderMercadoPago.findUnique({
      where: { mercadoPagoOrderId },
      include: { cobranca: true },
    });
    return order?.cobranca
      ? PrismaCobrancaMapper.toDomain(order.cobranca)
      : null;
  }
}
