import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { OrcamentoGateway } from '../../application/ports/orcamento.gateway';
import { Orcamento } from '../../domain/entities/orcamento.entity';
import { SituacaoOrcamento } from '../../domain/situacao-orcamento';
import { PrismaOrcamentoMapper } from './prisma-orcamento.mapper';

const includeItens = { itens: true } as const;

@Injectable()
export class PrismaOrcamentoGateway implements OrcamentoGateway {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorId(id: string): Promise<Orcamento | null> {
    const raw = await this.prisma.orcamento.findUnique({
      where: { id },
      include: includeItens,
    });
    return raw ? PrismaOrcamentoMapper.toDomain(raw) : null;
  }

  async buscarPorOrdemServicoERodada(
    contexto: ContextoTransacao,
    ordemServicoId: string,
    rodada: number,
  ): Promise<Orcamento | null> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.orcamento.findUnique({
      where: {
        ordemServicoId_rodada: { ordemServicoId, rodada },
      },
      include: includeItens,
    });
    return raw ? PrismaOrcamentoMapper.toDomain(raw) : null;
  }

  async criar(
    contexto: ContextoTransacao,
    orcamento: Orcamento,
  ): Promise<Orcamento> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.orcamento.create({
      data: PrismaOrcamentoMapper.toPersistence(orcamento),
      include: includeItens,
    });
    return PrismaOrcamentoMapper.toDomain(raw);
  }

  async atualizar(
    contexto: ContextoTransacao,
    id: string,
    orcamento: Orcamento,
  ): Promise<Orcamento> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.orcamento.update({
      where: { id },
      data: PrismaOrcamentoMapper.toUpdatePersistence(orcamento),
      include: includeItens,
    });
    return PrismaOrcamentoMapper.toDomain(raw);
  }

  async listar(
    page: number,
    limit: number,
    filtros: { ordemServicoId?: string; clienteId?: string },
  ): Promise<{ itens: Orcamento[]; total: number }> {
    const where = {
      ...(filtros.ordemServicoId
        ? { ordemServicoId: filtros.ordemServicoId }
        : {}),
      ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.orcamento.findMany({
        where,
        include: includeItens,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.orcamento.count({ where }),
    ]);

    return {
      itens: rows.map((r) => PrismaOrcamentoMapper.toDomain(r)),
      total,
    };
  }

  async reivindicarAprovacoesPendentes(
    posseMs: number,
    limite = 10,
  ): Promise<Orcamento[]> {
    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + posseMs);

    const rows = await this.prisma.$transaction(async (tx) => {
      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM orcamentos
        WHERE situacao = ${SituacaoOrcamento.APROVACAO_EM_ANDAMENTO}::"SituacaoOrcamento"
          AND (bloqueado_aprovacao_ate IS NULL OR bloqueado_aprovacao_ate < ${agora})
        ORDER BY atualizado_em
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED`;

      if (pendentes.length === 0) return [];

      await tx.orcamento.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { bloqueadoAprovacaoAte: bloqueadoAte },
      });

      return tx.orcamento.findMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        include: includeItens,
      });
    });

    return rows.map((r) => PrismaOrcamentoMapper.toDomain(r));
  }

  async liberarBloqueioAprovacao(id: string): Promise<void> {
    await this.prisma.orcamento.update({
      where: { id },
      data: { bloqueadoAprovacaoAte: null },
    });
  }

  async adiarBloqueioAprovacao(id: string, atrasoMs: number): Promise<void> {
    await this.prisma.orcamento.update({
      where: { id },
      data: { bloqueadoAprovacaoAte: new Date(Date.now() + atrasoMs) },
    });
  }

  async iniciarAprovacaoSeGerado(
    contexto: ContextoTransacao,
    id: string,
  ): Promise<Orcamento | null> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const atualizado = await cliente.orcamento.updateMany({
      where: { id, situacao: SituacaoOrcamento.GERADO },
      data: {
        situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
        tentativaAprovacao: { increment: 1 },
        bloqueadoAprovacaoAte: null,
      },
    });
    if (atualizado.count === 0) return null;

    const raw = await cliente.orcamento.findUnique({
      where: { id },
      include: includeItens,
    });
    return raw ? PrismaOrcamentoMapper.toDomain(raw) : null;
  }
}
