import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  CriarPendenciaEstornoInput,
  PendenciaEstornoGateway,
  PendenciaEstornoRegistro,
} from '../../application/ports/pendencia-estorno.gateway';

@Injectable()
export class PrismaPendenciaEstornoGateway implements PendenciaEstornoGateway {
  constructor(private readonly prisma: PrismaService) {}

  async criar(
    contexto: ContextoTransacao,
    input: CriarPendenciaEstornoInput,
  ): Promise<PendenciaEstornoRegistro> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.pendenciaEstorno.create({
      data: {
        cobrancaId: input.cobrancaId,
        ordemServicoId: input.ordemServicoId,
        rodada: input.rodada,
        valorCobrancaCentavos: input.valorCobrancaCentavos,
        motivoAbertura: input.motivoAbertura,
      },
    });
    return this.map(raw);
  }

  async buscarPorId(id: string): Promise<PendenciaEstornoRegistro | null> {
    const raw = await this.prisma.pendenciaEstorno.findUnique({
      where: { id },
    });
    return raw ? this.map(raw) : null;
  }

  async buscarAbertaPorCobrancaId(
    cobrancaId: string,
  ): Promise<PendenciaEstornoRegistro | null> {
    const raw = await this.prisma.pendenciaEstorno.findFirst({
      // Pendências de estorno automático pertencem a outra order, não ao
      // cancelamento financeiro da cobrança.
      where: {
        cobrancaId,
        situacao: 'ABERTA',
        estornosAutomaticos: { none: {} },
      },
      orderBy: { criadoEm: 'asc' },
    });
    return raw ? this.map(raw) : null;
  }

  async listarAbertas(
    page: number,
    limit: number,
  ): Promise<{ itens: PendenciaEstornoRegistro[]; total: number }> {
    const where = { situacao: 'ABERTA' as const };
    const [itens, total] = await Promise.all([
      this.prisma.pendenciaEstorno.findMany({
        where,
        orderBy: { criadoEm: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pendenciaEstorno.count({ where }),
    ]);
    return { itens: itens.map((i) => this.map(i)), total };
  }

  async resolver(
    contexto: ContextoTransacao,
    id: string,
    dados: {
      responsavelId: string;
      decisao: 'ESTORNO_INTEGRAL' | 'ESTORNO_PARCIAL' | 'SEM_ESTORNO';
      valorEstornadoCentavos?: number | null;
      justificativa?: string | null;
    },
  ): Promise<PendenciaEstornoRegistro> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.pendenciaEstorno.update({
      where: { id },
      data: {
        situacao: 'RESOLVIDA',
        responsavelId: dados.responsavelId,
        decisao: dados.decisao,
        valorEstornadoCentavos: dados.valorEstornadoCentavos ?? null,
        justificativa: dados.justificativa ?? null,
        resolvidaEm: new Date(),
      },
    });
    return this.map(raw);
  }

  private map(raw: {
    id: string;
    cobrancaId: string;
    ordemServicoId: string;
    rodada: number;
    valorCobrancaCentavos: number;
    situacao: 'ABERTA' | 'RESOLVIDA';
    motivoAbertura: string;
    responsavelId: string | null;
    decisao: 'ESTORNO_INTEGRAL' | 'ESTORNO_PARCIAL' | 'SEM_ESTORNO' | null;
    valorEstornadoCentavos: number | null;
    justificativa: string | null;
    resolvidaEm: Date | null;
  }): PendenciaEstornoRegistro {
    return {
      id: raw.id,
      cobrancaId: raw.cobrancaId,
      ordemServicoId: raw.ordemServicoId,
      rodada: raw.rodada,
      valorCobrancaCentavos: raw.valorCobrancaCentavos,
      situacao: raw.situacao,
      motivoAbertura: raw.motivoAbertura,
      responsavelId: raw.responsavelId,
      decisao: raw.decisao,
      valorEstornadoCentavos: raw.valorEstornadoCentavos,
      justificativa: raw.justificativa,
      resolvidaEm: raw.resolvidaEm,
    };
  }
}
