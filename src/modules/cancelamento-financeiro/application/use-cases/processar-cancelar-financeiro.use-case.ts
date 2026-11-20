import { randomUUID } from 'node:crypto';
import { ConteudoMensagemDivergenteError } from '@/modules/orcamentos/domain/errors/orcamento.errors';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import { Prisma } from '@/shared/generated/prisma/client';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import {
  type EnvelopeMensagem,
  EVENTO_CANCELAR_FINANCEIRO,
  type PayloadCancelarFinanceiro,
} from '@/shared/messaging/envelope';
import { hashEnvelope } from '@/shared/messaging/hash-envelope';
import { validarEnvelopeBase } from '@/shared/messaging/validar-envelope';
import type { BloqueioCriacaoCobrancaGateway } from '../ports/bloqueio-criacao-cobranca.gateway';
import type { OperacaoFinanceiraGateway } from '../ports/operacao-financeira.gateway';

export class ProcessarCancelarFinanceiroUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly bloqueios: BloqueioCriacaoCobrancaGateway,
    private readonly operacoes: OperacaoFinanceiraGateway,
    private readonly mensagensProcessadas: MensagemProcessadaGateway,
  ) {}

  async processar(envelopeBruto: unknown): Promise<void> {
    validarEnvelopeBase(envelopeBruto);

    const envelope =
      envelopeBruto as EnvelopeMensagem<PayloadCancelarFinanceiro>;
    if (envelope.eventType !== EVENTO_CANCELAR_FINANCEIRO) {
      return;
    }

    const hash = hashEnvelope(envelope);

    try {
      await this.unitOfWork.executar(async (contexto) => {
        await this.processarNaTransacao(contexto, envelope, hash);
      });
    } catch (erro) {
      if (!violacaoUnicidadeEventId(erro)) {
        throw erro;
      }
      await this.unitOfWork.executar(async (contexto) => {
        await this.registrarAposConcorrencia(contexto, envelope, hash, erro);
      });
    }
  }

  private async processarNaTransacao(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem<PayloadCancelarFinanceiro>,
    hash: string,
  ): Promise<void> {
    const jaProcessada = await this.mensagensProcessadas.jaProcessada(
      contexto,
      envelope.eventId,
    );
    if (jaProcessada) {
      const hashExistente = await this.mensagensProcessadas.buscarHash(
        contexto,
        envelope.eventId,
      );
      if (hashExistente && hashExistente !== hash) {
        throw new ConteudoMensagemDivergenteError(envelope.eventId);
      }
      return;
    }

    const operacaoExistente = await this.operacoes.buscarPorEventId(
      contexto,
      envelope.eventId,
    );
    if (operacaoExistente) {
      await this.mensagensProcessadas.registrar(
        contexto,
        envelope.eventId,
        hash,
      );
      return;
    }

    await this.bloqueios.garantir(
      contexto,
      envelope.ordemServicoId,
      envelope.rodada,
      envelope.payload.motivo,
    );

    await this.operacoes.criar(contexto, {
      eventId: envelope.eventId,
      ordemServicoId: envelope.ordemServicoId,
      rodada: envelope.rodada,
      correlationId: envelope.correlationId,
      chaveIdempotenciaMercadoPago: randomUUID(),
      resultadoExecucao: envelope.payload.resultadoExecucao,
      motivoCancelamento: envelope.payload.motivo,
      etapaOrigem: envelope.payload.etapaOrigem,
    });

    await this.mensagensProcessadas.registrar(contexto, envelope.eventId, hash);
  }

  private async registrarAposConcorrencia(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem<PayloadCancelarFinanceiro>,
    hash: string,
    erroOriginal: unknown,
  ): Promise<void> {
    const operacaoExistente = await this.operacoes.buscarPorEventId(
      contexto,
      envelope.eventId,
    );
    if (!operacaoExistente) {
      throw erroOriginal;
    }
    const jaProcessada = await this.mensagensProcessadas.jaProcessada(
      contexto,
      envelope.eventId,
    );
    if (jaProcessada) {
      return;
    }
    await this.mensagensProcessadas.registrar(contexto, envelope.eventId, hash);
  }
}

function violacaoUnicidadeEventId(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === 'P2002'
  );
}
