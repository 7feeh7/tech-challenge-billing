import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import type { EstornoAutomaticoGateway } from '@/modules/cobrancas/application/ports/estorno-automatico.gateway';
import type { MercadoPagoGateway } from '@/modules/cobrancas/application/ports/mercado-pago.gateway';
import type { OperacaoCriacaoOrderGateway } from '@/modules/cobrancas/application/ports/operacao-criacao-order.gateway';
import type {
  OrderMercadoPagoGateway,
  OrderMercadoPagoRegistro,
} from '@/modules/cobrancas/application/ports/order-mercado-pago.gateway';
import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import { interpretarEstornoOrder } from '@/modules/cobrancas/domain/interpretar-estorno-order';
import { interpretarSituacaoFinanceira } from '@/modules/cobrancas/domain/interpretar-situacao-order';
import { SituacaoCobranca } from '@/modules/cobrancas/domain/situacao-cobranca';
import type { OrcamentoGateway } from '@/modules/orcamentos/application/ports/orcamento.gateway';
import { SituacaoOrcamento } from '@/modules/orcamentos/domain/situacao-orcamento';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_RESPOSTA_CANCELAMENTO,
  type PayloadRespostaCancelamentoFinanceiro,
} from '@/shared/messaging/envelope';
import {
  METRICA_LOG,
  serializarMetricaLog,
} from '@/shared/observability/metrica-log';
import type {
  OperacaoFinanceiraGateway,
  OperacaoFinanceiraRegistro,
  ResultadoCancelamentoFinanceiroRegistro,
} from '../ports/operacao-financeira.gateway';
import type { PendenciaEstornoGateway } from '../ports/pendencia-estorno.gateway';

const CODIGOS_AGUARDAR_MP = new Set([
  'refund_in_progress',
  'movement_operations_pending',
]);

const CODIGOS_VERIFICAR_GET = new Set([
  'cannot_cancel_order',
  'order_already_refunded',
]);

export class ExecutarCancelamentoFinanceiroService {
  private readonly logger = new Logger(
    ExecutarCancelamentoFinanceiroService.name,
  );

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly operacoes: OperacaoFinanceiraGateway,
    private readonly orcamentos: OrcamentoGateway,
    private readonly cobrancas: CobrancaGateway,
    private readonly operacoesCriacao: OperacaoCriacaoOrderGateway,
    private readonly orders: OrderMercadoPagoGateway,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly pendencias: PendenciaEstornoGateway,
    private readonly outbox: OutboxGateway,
    private readonly atrasoAguardarMs: number,
    private readonly maxTentativasMercadoPago: number,
    private readonly atrasoRetryMercadoPagoMs: number,
    private readonly estornosAutomaticos: EstornoAutomaticoGateway,
  ) {}

  async executar(operacaoId: string): Promise<void> {
    const operacao = await this.operacoes.buscarPorId(operacaoId);
    if (
      !operacao ||
      operacao.situacao !== 'EM_ANDAMENTO' ||
      operacao.tipo !== 'CANCELAMENTO_FINANCEIRO'
    ) {
      return;
    }

    if (await this.deveAguardar(operacao)) {
      await this.operacoes.adiarProcessamento(
        operacao.id,
        new Date(Date.now() + this.atrasoAguardarMs),
      );
      return;
    }

    const cobranca = await this.cobrancas.buscarPorOrdemServicoERodada(
      operacao.ordemServicoId,
      operacao.rodada,
    );

    if (!cobranca?.id) {
      await this.concluirOperacao(operacao, null, 'NADA_A_CANCELAR', null);
      return;
    }

    const resultadoExistente = this.resultadoParaSituacaoTerminal(cobranca);
    if (resultadoExistente) {
      await this.concluirOperacao(
        operacao,
        cobranca.id,
        resultadoExistente,
        null,
      );
      return;
    }

    if (this.semPagamento(cobranca)) {
      if (await this.tratarOrderEmEstornoAutomatico(operacao, cobranca)) return;
      const ok = await this.cancelarCobrancaNaoPaga(operacao, cobranca);
      if (!ok) return;
      await this.concluirOperacao(operacao, cobranca.id, 'CANCELADA', null);
      return;
    }

    // ESTORNO_EM_ANDAMENTO é o estorno de um ciclo anterior cujo resultado ficou
    // indeterminado: cada ciclo o retoma até concluir ou abrir a pendência.
    if (
      cobranca.situacao === SituacaoCobranca.PAGA ||
      cobranca.situacao === SituacaoCobranca.ESTORNO_EM_ANDAMENTO
    ) {
      if (
        cobranca.situacao === SituacaoCobranca.PAGA &&
        operacao.resultadoExecucao === 'REPARO_INICIADO'
      ) {
        await this.abrirPendencia(operacao, cobranca, 'reparo_iniciado');
        return;
      }
      const ok = await this.estornarCobrancaPaga(operacao, cobranca);
      if (!ok) return;
      await this.concluirOperacao(operacao, cobranca.id, 'ESTORNADA', null);
    }
  }

  private async deveAguardar(
    operacao: OperacaoFinanceiraRegistro,
  ): Promise<boolean> {
    const orcamento = await this.orcamentos.buscarPorOrdemServicoERodadaLeitura(
      operacao.ordemServicoId,
      operacao.rodada,
    );
    if (orcamento?.situacao === SituacaoOrcamento.APROVACAO_EM_ANDAMENTO) {
      return true;
    }

    const cobranca = await this.cobrancas.buscarPorOrdemServicoERodada(
      operacao.ordemServicoId,
      operacao.rodada,
    );
    if (!cobranca?.id || cobranca.situacao !== SituacaoCobranca.INTENCAO) {
      return false;
    }

    const criacao = await this.operacoesCriacao.obterPorCobrancaId(cobranca.id);
    return criacao?.situacao === 'EM_ANDAMENTO';
  }

  private resultadoParaSituacaoTerminal(
    cobranca: Cobranca,
  ): ResultadoCancelamentoFinanceiroRegistro | null {
    if (cobranca.situacao === SituacaoCobranca.CANCELADA) {
      return 'CANCELADA';
    }
    if (cobranca.situacao === SituacaoCobranca.ESTORNADA) {
      return 'ESTORNADA';
    }
    if (cobranca.situacao === SituacaoCobranca.PENDENCIA_MANUAL) {
      return 'PENDENCIA_MANUAL_ABERTA';
    }
    return null;
  }

  private semPagamento(cobranca: Cobranca): boolean {
    return (
      cobranca.situacao === SituacaoCobranca.INTENCAO ||
      cobranca.situacao === SituacaoCobranca.PENDENTE ||
      cobranca.situacao === SituacaoCobranca.EXPIRADA
    );
  }

  // A order paga de um estorno automático (pagamento tardio) já tem dono: o
  // cancelamento espera o desfecho dele em vez de tratá-la como pagamento
  // legítimo, o que abriria outra pendência ou um segundo estorno.
  private async tratarOrderEmEstornoAutomatico(
    operacao: OperacaoFinanceiraRegistro,
    cobranca: Cobranca,
  ): Promise<boolean> {
    const order = await this.orders.buscarAtivaPorCobrancaId(
      cobranca.id as string,
    );
    if (!order?.id) return false;
    const estorno = await this.estornosAutomaticos.buscarPorOrderMercadoPagoId(
      order.id,
    );
    if (!estorno) return false;

    if (estorno.situacao === 'EM_ANDAMENTO') {
      await this.operacoes.adiarProcessamento(
        operacao.id,
        new Date(Date.now() + this.atrasoAguardarMs),
      );
      return true;
    }
    if (estorno.situacao === 'PENDENCIA_MANUAL') {
      await this.concluirOperacao(
        operacao,
        cobranca.id as string,
        'PENDENCIA_MANUAL_ABERTA',
        estorno.pendenciaId,
      );
      return true;
    }
    return false;
  }

  private async cancelarCobrancaNaoPaga(
    operacao: OperacaoFinanceiraRegistro,
    cobranca: Cobranca,
  ): Promise<boolean> {
    const order = await this.orders.buscarAtivaPorCobrancaId(
      cobranca.id as string,
    );
    if (!order) {
      await this.unitOfWork.executar((ctx) =>
        this.marcarCanceladaSeAindaAberta(ctx, cobranca),
      );
      return true;
    }

    const resposta = await this.mercadoPago.cancelarOrder(
      order.mercadoPagoOrderId,
      operacao.chaveIdempotenciaMercadoPago,
    );

    if (resposta.tipo === 'indeterminado') {
      await this.tratarFalhaMercadoPago(operacao);
      return false;
    }

    if (resposta.tipo === 'conflito_especifico') {
      if (CODIGOS_VERIFICAR_GET.has(resposta.codigo)) {
        const confirmado = await this.confirmarCancelamentoPorGet(
          order.mercadoPagoOrderId,
        );
        if (!confirmado) {
          await this.tratarFalhaMercadoPago(operacao);
          return false;
        }
      } else if (CODIGOS_AGUARDAR_MP.has(resposta.codigo)) {
        await this.operacoes.adiarProcessamento(
          operacao.id,
          new Date(Date.now() + this.atrasoRetryMercadoPagoMs),
        );
        await this.operacoes.incrementarTentativasMercadoPago(operacao.id);
        return false;
      } else {
        await this.tratarFalhaMercadoPago(operacao);
        return false;
      }
    }

    const confirmado = await this.confirmarCancelamentoPorGet(
      order.mercadoPagoOrderId,
    );
    if (!confirmado) {
      await this.tratarFalhaMercadoPago(operacao);
      return false;
    }

    await this.unitOfWork.executar(async (ctx) => {
      await this.marcarCanceladaSeAindaAberta(ctx, cobranca);
      if (order.id) {
        await this.orders.desativar(ctx, order.id);
      }
    });
    return true;
  }

  // A cobrança expirada já está encerrada sem pagamento e o OS já recebeu
  // CobrancaExpirada; regravá-la como CANCELADA apagaria esse fato.
  private async marcarCanceladaSeAindaAberta(
    ctx: ContextoTransacao,
    cobranca: Cobranca,
  ): Promise<void> {
    if (cobranca.situacao === SituacaoCobranca.EXPIRADA) return;

    const copia = this.clonar(cobranca);
    copia.marcarCancelada();
    await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
  }

  private async confirmarCancelamentoPorGet(orderId: string): Promise<boolean> {
    const consulta = await this.mercadoPago.consultarOrder(orderId);
    if (consulta.tipo !== 'sucesso') {
      return false;
    }
    const situacao = interpretarSituacaoFinanceira(consulta.order);
    return situacao.tipo === 'encerrada_sem_pagamento';
  }

  private async estornarCobrancaPaga(
    operacao: OperacaoFinanceiraRegistro,
    cobranca: Cobranca,
  ): Promise<boolean> {
    // A order que confirmou o pagamento, nunca a de um segundo pagamento.
    const order = await this.orders.buscarQueConfirmouPagamento(
      cobranca.id as string,
    );
    if (!order) {
      await this.unitOfWork.executar(async (ctx) => {
        const copia = this.clonar(cobranca);
        copia.marcarEstornada();
        await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
      });
      return true;
    }

    if (
      cobranca.situacao === SituacaoCobranca.ESTORNO_EM_ANDAMENTO &&
      (await this.confirmarEstornoPorGet(order.mercadoPagoOrderId))
    ) {
      await this.registrarEstornada(cobranca, order);
      return true;
    }

    await this.unitOfWork.executar(async (ctx) => {
      const copia = this.clonar(cobranca);
      copia.iniciarEstorno();
      await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
    });

    const resposta = await this.mercadoPago.estornarTotal(
      order.mercadoPagoOrderId,
      operacao.chaveIdempotenciaMercadoPago,
    );

    if (resposta.tipo === 'indeterminado') {
      await this.tratarFalhaMercadoPago(operacao);
      return false;
    }

    if (resposta.tipo === 'conflito_especifico') {
      if (CODIGOS_AGUARDAR_MP.has(resposta.codigo)) {
        await this.operacoes.adiarProcessamento(
          operacao.id,
          new Date(Date.now() + this.atrasoRetryMercadoPagoMs),
        );
        await this.operacoes.incrementarTentativasMercadoPago(operacao.id);
        return false;
      }
      if (CODIGOS_VERIFICAR_GET.has(resposta.codigo)) {
        const confirmado = await this.confirmarEstornoPorGet(
          order.mercadoPagoOrderId,
        );
        if (!confirmado) {
          await this.tratarFalhaMercadoPago(operacao);
          return false;
        }
      } else {
        await this.tratarFalhaMercadoPago(operacao);
        return false;
      }
    } else {
      const confirmado = await this.confirmarEstornoPorGet(
        order.mercadoPagoOrderId,
      );
      if (!confirmado) {
        await this.tratarFalhaMercadoPago(operacao);
        return false;
      }
    }

    await this.registrarEstornada(cobranca, order);
    return true;
  }

  private async registrarEstornada(
    cobranca: Cobranca,
    order: OrderMercadoPagoRegistro,
  ): Promise<void> {
    await this.unitOfWork.executar(async (ctx) => {
      const atual = await this.cobrancas.buscarPorId(cobranca.id as string);
      if (!atual?.id) return;
      const copia = this.clonar(atual);
      copia.marcarEstornada();
      await this.cobrancas.atualizar(ctx, atual.id, copia);
      if (order.id) {
        await this.orders.desativar(ctx, order.id);
      }
    });
  }

  private async confirmarEstornoPorGet(orderId: string): Promise<boolean> {
    const consulta = await this.mercadoPago.consultarOrder(orderId);
    if (consulta.tipo !== 'sucesso') {
      return false;
    }
    const estorno = interpretarEstornoOrder(consulta.order);
    return estorno.tipo === 'estorno_integral';
  }

  private async abrirPendencia(
    operacao: OperacaoFinanceiraRegistro,
    cobranca: Cobranca,
    motivo: 'reparo_iniciado' | 'operacao_indeterminada',
  ): Promise<void> {
    const pagamentoRevelado = await this.consultarPagamentoRevelado(cobranca);
    const pagamentoConfirmado =
      cobranca.pagamentoConfirmado() || pagamentoRevelado !== null;
    const pendenciaId = await this.unitOfWork.executar(async (ctx) => {
      // Sem pagamento confirmado a cobrança não muda de situação: marcá-la como
      // paga esconderia um pagamento posterior (nenhum PagamentoConfirmado) e
      // faria o resolver estornar dinheiro que nunca entrou. A pendência
      // aberta é sempre reaproveitada: se a conclusão falhar e o reprocesso
      // revelar o pagamento, a cobrança ganha a situação coerente sem outra
      // pendência.
      const existente = await this.pendencias.buscarAbertaPorCobrancaId(
        cobranca.id as string,
      );
      const pendencia =
        existente ??
        (await this.pendencias.criar(ctx, {
          cobrancaId: cobranca.id as string,
          ordemServicoId: cobranca.ordemServicoId,
          rodada: cobranca.rodada,
          valorCobrancaCentavos: cobranca.valorTotalCentavos,
          motivoAbertura:
            operacao.motivoCancelamento ??
            'Cancelamento financeiro com reparo já iniciado.',
        }));
      if (!pagamentoConfirmado) return pendencia.id;

      const copia = this.clonar(cobranca);
      copia.marcarPendenciaManual(pagamentoRevelado?.aprovadoEm);
      await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
      if (pagamentoRevelado?.order.id) {
        await this.orders.marcarConfirmouPagamento(
          ctx,
          pagamentoRevelado.order.id,
        );
      }
      return pendencia.id;
    });

    // Após o commit e antes de concluir: se a conclusão falhar, o reprocesso
    // encontra a cobrança em PENDENCIA_MANUAL e não abre (nem sinaliza) outra.
    this.logger.warn(
      serializarMetricaLog(METRICA_LOG.PENDENCIA_ESTORNO_ABERTA, {
        ordemServicoId: cobranca.ordemServicoId,
        rodada: cobranca.rodada,
        correlationId: operacao.correlationId,
        operacaoId: operacao.id,
        cobrancaId: cobranca.id,
        motivo,
      }),
    );

    await this.concluirOperacao(
      operacao,
      cobranca.id as string,
      'PENDENCIA_MANUAL_ABERTA',
      pendenciaId,
    );
  }

  // Cobrança ainda sem pagamento confirmado (PENDENTE ou EXPIRADA) com order
  // ativa: o pagamento revelado pela consulta torna a pendência coerente com a
  // cobrança e identifica a order paga como a legítima.
  private async consultarPagamentoRevelado(
    cobranca: Cobranca,
  ): Promise<{ order: OrderMercadoPagoRegistro; aprovadoEm: Date } | null> {
    if (cobranca.pagamentoConfirmado()) return null;
    const order = await this.orders.buscarAtivaPorCobrancaId(
      cobranca.id as string,
    );
    if (!order) return null;
    if (
      order.id &&
      (await this.estornosAutomaticos.buscarPorOrderMercadoPagoId(order.id))
    ) {
      return null;
    }

    const consulta = await this.mercadoPago.consultarOrder(
      order.mercadoPagoOrderId,
    );
    if (consulta.tipo !== 'sucesso') return null;
    const situacao = interpretarSituacaoFinanceira(consulta.order);
    if (situacao.tipo !== 'paga') return null;
    return { order, aprovadoEm: situacao.aprovadoEm };
  }

  private async tratarFalhaMercadoPago(
    operacao: OperacaoFinanceiraRegistro,
  ): Promise<void> {
    const tentativas = operacao.tentativasMercadoPago + 1;
    await this.operacoes.incrementarTentativasMercadoPago(operacao.id);

    if (tentativas >= this.maxTentativasMercadoPago) {
      const cobranca = await this.cobrancas.buscarPorOrdemServicoERodada(
        operacao.ordemServicoId,
        operacao.rodada,
      );
      if (cobranca?.id) {
        // Emitido antes de abrir a pendência: se a abertura falhar, o próximo
        // ciclo repete este sinal junto com a nova tentativa registrada.
        this.logger.warn(
          serializarMetricaLog(METRICA_LOG.OPERACAO_FINANCEIRA_INDETERMINADA, {
            ordemServicoId: operacao.ordemServicoId,
            rodada: operacao.rodada,
            correlationId: operacao.correlationId,
            operacaoId: operacao.id,
            cobrancaId: cobranca.id,
            motivo: 'tentativas_esgotadas',
          }),
        );
        await this.abrirPendencia(operacao, cobranca, 'operacao_indeterminada');
      }
      return;
    }

    await this.operacoes.adiarProcessamento(
      operacao.id,
      new Date(Date.now() + this.atrasoRetryMercadoPagoMs),
    );
  }

  private async concluirOperacao(
    operacao: OperacaoFinanceiraRegistro,
    cobrancaId: string | null,
    resultado: ResultadoCancelamentoFinanceiroRegistro,
    pendenciaId: string | null,
  ): Promise<void> {
    const eventoRespostaId = randomUUID();
    await this.unitOfWork.executar(async (ctx) => {
      await this.operacoes.concluir(ctx, operacao.id, {
        cobrancaId,
        resultado,
        pendenciaId,
      });

      const envelope: EnvelopeMensagem<PayloadRespostaCancelamentoFinanceiro> =
        {
          eventId: eventoRespostaId,
          eventType: EVENTO_RESPOSTA_CANCELAMENTO,
          version: 1,
          occurredAt: new Date().toISOString(),
          source: 'billing',
          correlationId: operacao.correlationId,
          causationId: operacao.eventId,
          ordemServicoId: operacao.ordemServicoId,
          rodada: operacao.rodada,
          payload: {
            resultado,
            pendenciaId,
          },
        };

      await this.outbox.registrar(ctx, {
        eventId: eventoRespostaId,
        eventType: EVENTO_RESPOSTA_CANCELAMENTO,
        envelope,
        correlationId: operacao.correlationId,
        destino: DESTINO_FILA_OS,
      });
    });
  }

  private clonar(cobranca: Cobranca): Cobranca {
    return new Cobranca({
      id: cobranca.id,
      orcamentoId: cobranca.orcamentoId,
      ordemServicoId: cobranca.ordemServicoId,
      rodada: cobranca.rodada,
      clienteId: cobranca.clienteId,
      correlationId: cobranca.correlationId,
      valorTotalCentavos: cobranca.valorTotalCentavos,
      prazoPagamento: cobranca.prazoPagamento,
      situacao: cobranca.situacao,
      linkPagamento: cobranca.linkPagamento,
      pagamentoConfirmadoEm: cobranca.pagamentoConfirmadoEm,
      bloqueadoConciliacaoAte: cobranca.bloqueadoConciliacaoAte,
      criadoEm: cobranca.criadoEm,
    });
  }
}
