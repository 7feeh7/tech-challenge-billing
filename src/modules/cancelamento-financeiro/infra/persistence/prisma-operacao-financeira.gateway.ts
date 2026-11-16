import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  CriarOperacaoFinanceiraInput,
  OperacaoFinanceiraGateway,
  OperacaoFinanceiraRegistro,
} from '../../application/ports/operacao-financeira.gateway';

@Injectable()
export class PrismaOperacaoFinanceiraGateway
  implements OperacaoFinanceiraGateway
{
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorId(id: string): Promise<OperacaoFinanceiraRegistro | null> {
    const raw = await this.prisma.operacaoFinanceira.findUnique({
      where: { id },
    });
    return raw ? this.map(raw) : null;
  }

  async buscarPorEventId(
    contexto: ContextoTransacao,
    eventId: string,
  ): Promise<OperacaoFinanceiraRegistro | null> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.operacaoFinanceira.findUnique({
      where: { eventId },
    });
    return raw ? this.map(raw) : null;
  }

  async criar(
    contexto: ContextoTransacao,
    input: CriarOperacaoFinanceiraInput,
  ): Promise<OperacaoFinanceiraRegistro> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const raw = await cliente.operacaoFinanceira.create({
      data: {
        eventId: input.eventId,
        ordemServicoId: input.ordemServicoId,
        rodada: input.rodada,
        correlationId: input.correlationId,
        tipo: 'CANCELAMENTO_FINANCEIRO',
        chaveIdempotenciaMercadoPago: input.chaveIdempotenciaMercadoPago,
        resultadoExecucao: input.resultadoExecucao,
        motivoCancelamento: input.motivoCancelamento ?? null,
        etapaOrigem: input.etapaOrigem ?? null,
      },
    });
    return this.map(raw);
  }

  async concluir(
    contexto: ContextoTransacao,
    id: string,
    dados: {
      cobrancaId?: string | null;
      resultado: NonNullable<OperacaoFinanceiraRegistro['resultado']>;
      pendenciaId?: string | null;
    },
  ): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.operacaoFinanceira.update({
      where: { id },
      data: {
        situacao: 'CONCLUIDA',
        cobrancaId: dados.cobrancaId ?? null,
        resultado: dados.resultado,
        pendenciaId: dados.pendenciaId ?? null,
        bloqueadoProcessamentoAte: null,
      },
    });
  }

  async adiarProcessamento(id: string, ate: Date): Promise<void> {
    await this.prisma.operacaoFinanceira.update({
      where: { id },
      data: { bloqueadoProcessamentoAte: ate },
    });
  }

  async incrementarTentativasMercadoPago(id: string): Promise<void> {
    await this.prisma.operacaoFinanceira.update({
      where: { id },
      data: { tentativasMercadoPago: { increment: 1 } },
    });
  }

  async reivindicarEmAndamento(
    limite: number,
    posseMs: number,
  ): Promise<OperacaoFinanceiraRegistro[]> {
    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + posseMs);

    const rows = await this.prisma.$transaction(async (tx) => {
      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM operacoes_financeiras
        WHERE situacao = 'EM_ANDAMENTO'
          AND (bloqueado_processamento_ate IS NULL OR bloqueado_processamento_ate < ${agora})
        ORDER BY criado_em
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED`;

      if (pendentes.length === 0) return [];

      await tx.operacaoFinanceira.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { bloqueadoProcessamentoAte: bloqueadoAte },
      });

      return tx.operacaoFinanceira.findMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
      });
    });

    return rows.map((r) => this.map(r));
  }

  private map(raw: {
    id: string;
    eventId: string;
    ordemServicoId: string;
    rodada: number;
    correlationId: string;
    situacao: 'EM_ANDAMENTO' | 'CONCLUIDA';
    chaveIdempotenciaMercadoPago: string;
    resultadoExecucao: 'REPARO_NAO_INICIADO' | 'REPARO_INICIADO';
    motivoCancelamento: string | null;
    etapaOrigem: string | null;
    cobrancaId: string | null;
    resultado:
      | 'NADA_A_CANCELAR'
      | 'CANCELADA'
      | 'ESTORNADA'
      | 'PENDENCIA_MANUAL_ABERTA'
      | null;
    pendenciaId: string | null;
    bloqueadoProcessamentoAte: Date | null;
    tentativasMercadoPago: number;
  }): OperacaoFinanceiraRegistro {
    return {
      id: raw.id,
      eventId: raw.eventId,
      ordemServicoId: raw.ordemServicoId,
      rodada: raw.rodada,
      correlationId: raw.correlationId,
      situacao: raw.situacao,
      chaveIdempotenciaMercadoPago: raw.chaveIdempotenciaMercadoPago,
      resultadoExecucao: raw.resultadoExecucao,
      motivoCancelamento: raw.motivoCancelamento,
      etapaOrigem: raw.etapaOrigem,
      cobrancaId: raw.cobrancaId,
      resultado: raw.resultado,
      pendenciaId: raw.pendenciaId,
      bloqueadoProcessamentoAte: raw.bloqueadoProcessamentoAte,
      tentativasMercadoPago: raw.tentativasMercadoPago,
    };
  }
}
