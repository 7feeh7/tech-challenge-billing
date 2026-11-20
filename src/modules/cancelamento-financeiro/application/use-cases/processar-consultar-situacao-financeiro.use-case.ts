import { ConteudoMensagemDivergenteError } from '@/modules/orcamentos/domain/errors/orcamento.errors';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import { Prisma } from '@/shared/generated/prisma/client';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import {
  type EnvelopeMensagem,
  EVENTO_CONSULTAR_SITUACAO_FINANCEIRA,
  type PayloadConsultarSituacaoFinanceira,
} from '@/shared/messaging/envelope';
import { hashEnvelope } from '@/shared/messaging/hash-envelope';
import { validarEnvelopeBase } from '@/shared/messaging/validar-envelope';
import type { OperacaoFinanceiraGateway } from '../ports/operacao-financeira.gateway';

export class ProcessarConsultarSituacaoFinanceiroUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly operacoes: OperacaoFinanceiraGateway,
    private readonly mensagensProcessadas: MensagemProcessadaGateway,
  ) {}

  async processar(envelopeBruto: unknown): Promise<void> {
    validarEnvelopeBase(envelopeBruto);

    const envelope =
      envelopeBruto as EnvelopeMensagem<PayloadConsultarSituacaoFinanceira>;
    if (envelope.eventType !== EVENTO_CONSULTAR_SITUACAO_FINANCEIRA) {
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
    envelope: EnvelopeMensagem<PayloadConsultarSituacaoFinanceira>,
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

    const porEvento = await this.operacoes.buscarPorEventId(
      contexto,
      envelope.eventId,
    );
    if (porEvento) {
      await this.mensagensProcessadas.registrar(
        contexto,
        envelope.eventId,
        hash,
      );
      return;
    }

    const porConsulta = await this.operacoes.buscarPorConsultaId(
      contexto,
      envelope.payload.consultaId,
    );
    if (porConsulta) {
      await this.mensagensProcessadas.registrar(
        contexto,
        envelope.eventId,
        hash,
      );
      return;
    }

    await this.operacoes.criarConsulta(contexto, {
      eventId: envelope.eventId,
      ordemServicoId: envelope.ordemServicoId,
      rodada: envelope.rodada,
      correlationId: envelope.correlationId,
      consultaId: envelope.payload.consultaId,
      finalidade: envelope.payload.finalidade,
    });

    await this.mensagensProcessadas.registrar(contexto, envelope.eventId, hash);
  }

  private async registrarAposConcorrencia(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem<PayloadConsultarSituacaoFinanceira>,
    hash: string,
    erroOriginal: unknown,
  ): Promise<void> {
    const existente =
      (await this.operacoes.buscarPorEventId(contexto, envelope.eventId)) ??
      (await this.operacoes.buscarPorConsultaId(
        contexto,
        envelope.payload.consultaId,
      ));
    if (!existente) {
      throw erroOriginal;
    }
    const jaProcessada = await this.mensagensProcessadas.jaProcessada(
      contexto,
      envelope.eventId,
    );
    if (jaProcessada) return;
    await this.mensagensProcessadas.registrar(contexto, envelope.eventId, hash);
  }
}

function violacaoUnicidadeEventId(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === 'P2002'
  );
}
