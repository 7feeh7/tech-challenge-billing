import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { obterClienteTransacao } from '@/shared/database/obter-cliente-transacao';
import { PrismaService } from '@/shared/database/prisma.service';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  EstornoAutomaticoGateway,
  EstornoAutomaticoRegistro,
  RegistrarEstornoAutomaticoInput,
  ResultadoRegistroEstornoAutomatico,
} from '../../application/ports/estorno-automatico.gateway';

const INCLUIR_ORDER = {
  orderMercadoPago: { select: { mercadoPagoOrderId: true } },
} as const;

type EstornoAutomaticoLinha = {
  id: string;
  cobrancaId: string;
  orderMercadoPagoId: string;
  tipo: EstornoAutomaticoRegistro['tipo'];
  situacao: EstornoAutomaticoRegistro['situacao'];
  chaveIdempotencia: string;
  valorCentavos: number;
  aprovadoEm: Date;
  tentativas: number;
  pendenciaId: string | null;
  orderMercadoPago: { mercadoPagoOrderId: string };
};

@Injectable()
export class PrismaEstornoAutomaticoGateway
  implements EstornoAutomaticoGateway
{
  constructor(private readonly prisma: PrismaService) {}

  async registrarSeNovo(
    contexto: ContextoTransacao,
    input: RegistrarEstornoAutomaticoInput,
  ): Promise<ResultadoRegistroEstornoAutomatico> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    // ON CONFLICT DO NOTHING: a segunda transação espera a primeira confirmar
    // e então não insere, sem abortar a própria transação.
    const resultado = await cliente.estornoAutomatico.createMany({
      data: [
        {
          cobrancaId: input.cobrancaId,
          orderMercadoPagoId: input.orderMercadoPagoId,
          tipo: input.tipo,
          chaveIdempotencia: randomUUID(),
          valorCentavos: input.valorCentavos,
          aprovadoEm: input.aprovadoEm,
        },
      ],
      skipDuplicates: true,
    });
    const linha = await cliente.estornoAutomatico.findUniqueOrThrow({
      where: { orderMercadoPagoId: input.orderMercadoPagoId },
      include: INCLUIR_ORDER,
    });
    return { estorno: this.mapear(linha), criado: resultado.count === 1 };
  }

  async buscarPorId(id: string): Promise<EstornoAutomaticoRegistro | null> {
    const linha = await this.prisma.estornoAutomatico.findUnique({
      where: { id },
      include: INCLUIR_ORDER,
    });
    return linha ? this.mapear(linha) : null;
  }

  async buscarPorOrderMercadoPagoId(
    orderMercadoPagoId: string,
  ): Promise<EstornoAutomaticoRegistro | null> {
    const linha = await this.prisma.estornoAutomatico.findUnique({
      where: { orderMercadoPagoId },
      include: INCLUIR_ORDER,
    });
    return linha ? this.mapear(linha) : null;
  }

  async buscarPorPendenciaId(
    pendenciaId: string,
  ): Promise<EstornoAutomaticoRegistro | null> {
    const linha = await this.prisma.estornoAutomatico.findFirst({
      where: { pendenciaId },
      include: INCLUIR_ORDER,
    });
    return linha ? this.mapear(linha) : null;
  }

  async reivindicar(
    id: string,
    posseMs: number,
  ): Promise<EstornoAutomaticoRegistro | null> {
    const agora = new Date();
    const resultado = await this.prisma.estornoAutomatico.updateMany({
      where: {
        id,
        situacao: 'EM_ANDAMENTO',
        OR: [
          { bloqueadoProcessamentoAte: null },
          { bloqueadoProcessamentoAte: { lt: agora } },
        ],
      },
      data: {
        bloqueadoProcessamentoAte: new Date(agora.getTime() + posseMs),
      },
    });
    if (resultado.count !== 1) return null;
    return this.buscarPorId(id);
  }

  async reivindicarEmAndamento(
    limite: number,
    posseMs: number,
  ): Promise<EstornoAutomaticoRegistro[]> {
    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + posseMs);

    const linhas = await this.prisma.$transaction(async (tx) => {
      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM estornos_automaticos
        WHERE situacao = 'EM_ANDAMENTO'
          AND (bloqueado_processamento_ate IS NULL OR bloqueado_processamento_ate < ${agora})
        ORDER BY criado_em
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED`;

      if (pendentes.length === 0) return [];

      await tx.estornoAutomatico.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { bloqueadoProcessamentoAte: bloqueadoAte },
      });

      return tx.estornoAutomatico.findMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        include: INCLUIR_ORDER,
      });
    });

    return linhas.map((linha) => this.mapear(linha));
  }

  async bloquearEmAndamento(
    contexto: ContextoTransacao,
    id: string,
  ): Promise<EstornoAutomaticoRegistro | null> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    const bloqueados = await cliente.$queryRaw<{ id: string }[]>`
      SELECT id FROM estornos_automaticos
      WHERE id = ${id}::uuid AND situacao = 'EM_ANDAMENTO'
      FOR UPDATE`;
    if (bloqueados.length === 0) return null;

    const linha = await cliente.estornoAutomatico.findUniqueOrThrow({
      where: { id },
      include: INCLUIR_ORDER,
    });
    return this.mapear(linha);
  }

  async incrementarTentativas(id: string): Promise<number> {
    const linha = await this.prisma.estornoAutomatico.update({
      where: { id },
      data: { tentativas: { increment: 1 } },
      select: { tentativas: true },
    });
    return linha.tentativas;
  }

  async adiar(id: string, ate: Date): Promise<void> {
    await this.prisma.estornoAutomatico.update({
      where: { id },
      data: { bloqueadoProcessamentoAte: ate },
    });
  }

  async concluir(contexto: ContextoTransacao, id: string): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.estornoAutomatico.update({
      where: { id },
      data: { situacao: 'CONCLUIDO', bloqueadoProcessamentoAte: null },
    });
  }

  async abrirPendenciaManual(
    contexto: ContextoTransacao,
    id: string,
    pendenciaId: string,
  ): Promise<void> {
    const cliente = obterClienteTransacao(contexto, this.prisma);
    await cliente.estornoAutomatico.update({
      where: { id },
      data: {
        situacao: 'PENDENCIA_MANUAL',
        pendenciaId,
        bloqueadoProcessamentoAte: null,
      },
    });
  }

  private mapear(linha: EstornoAutomaticoLinha): EstornoAutomaticoRegistro {
    return {
      id: linha.id,
      cobrancaId: linha.cobrancaId,
      orderMercadoPagoId: linha.orderMercadoPagoId,
      mercadoPagoOrderId: linha.orderMercadoPago.mercadoPagoOrderId,
      tipo: linha.tipo,
      situacao: linha.situacao,
      chaveIdempotencia: linha.chaveIdempotencia,
      valorCentavos: linha.valorCentavos,
      aprovadoEm: linha.aprovadoEm,
      tentativas: linha.tentativas,
      pendenciaId: linha.pendenciaId,
    };
  }
}
