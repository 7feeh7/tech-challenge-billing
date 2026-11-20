import { randomUUID } from 'node:crypto';
import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import { Prisma } from '@/shared/generated/prisma/client';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_GERAR_ORCAMENTO,
  EVENTO_ORCAMENTO_GERADO,
  type PayloadGerarOrcamento,
  type PayloadOrcamentoGerado,
} from '@/shared/messaging/envelope';
import { hashEnvelope } from '@/shared/messaging/hash-envelope';
import { validarEnvelopeBase } from '@/shared/messaging/validar-envelope';
import { Orcamento } from '../../domain/entities/orcamento.entity';
import { ConteudoMensagemDivergenteError } from '../../domain/errors/orcamento.errors';
import type { OrcamentoGateway } from '../ports/orcamento.gateway';

export class ProcessarGerarOrcamentoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly orcamentos: OrcamentoGateway,
    private readonly mensagensProcessadas: MensagemProcessadaGateway,
    private readonly outbox: OutboxGateway,
  ) {}

  async processar(envelopeBruto: unknown): Promise<void> {
    validarEnvelopeBase(envelopeBruto);

    const envelope =
      envelopeBruto as unknown as EnvelopeMensagem<PayloadGerarOrcamento>;
    if (envelope.eventType !== EVENTO_GERAR_ORCAMENTO) {
      return;
    }

    const hash = hashEnvelope(envelope);

    try {
      await this.unitOfWork.executar(async (contexto) => {
        await this.processarNaTransacao(contexto, envelope, hash);
      });
    } catch (erro) {
      if (!violacaoUnicidadeOrdemServicoRodada(erro)) {
        throw erro;
      }
      await this.unitOfWork.executar(async (contexto) => {
        await this.registrarAposConcorrencia(contexto, envelope, hash, erro);
      });
    }
  }

  private async processarNaTransacao(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem<PayloadGerarOrcamento>,
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

    const existente = await this.orcamentos.buscarPorOrdemServicoERodada(
      contexto,
      envelope.ordemServicoId,
      envelope.rodada,
    );

    if (existente?.id) {
      await this.mensagensProcessadas.registrar(
        contexto,
        envelope.eventId,
        hash,
      );
      return;
    }

    const orcamento = new Orcamento({
      ordemServicoId: envelope.ordemServicoId,
      rodada: envelope.rodada,
      clienteId: envelope.payload.clienteId,
      correlationId: envelope.correlationId,
      itens: envelope.payload.itens,
    });

    const persistido = await this.orcamentos.criar(contexto, orcamento);

    const eventoGerado: EnvelopeMensagem<PayloadOrcamentoGerado> = {
      eventId: randomUUID(),
      eventType: EVENTO_ORCAMENTO_GERADO,
      version: 1,
      occurredAt: new Date().toISOString(),
      source: 'billing',
      correlationId: envelope.correlationId,
      causationId: envelope.eventId,
      ordemServicoId: envelope.ordemServicoId,
      rodada: envelope.rodada,
      payload: {
        orcamentoId: persistido.id as string,
        valorTotalCentavos: persistido.valorTotalCentavos,
      },
    };

    await this.outbox.registrar(contexto, {
      eventId: eventoGerado.eventId,
      eventType: EVENTO_ORCAMENTO_GERADO,
      envelope: eventoGerado,
      correlationId: envelope.correlationId,
      destino: DESTINO_FILA_OS,
    });

    await this.mensagensProcessadas.registrar(contexto, envelope.eventId, hash);
  }

  private async registrarAposConcorrencia(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem<PayloadGerarOrcamento>,
    hash: string,
    erroOriginal: unknown,
  ): Promise<void> {
    const existente = await this.orcamentos.buscarPorOrdemServicoERodada(
      contexto,
      envelope.ordemServicoId,
      envelope.rodada,
    );
    if (!existente?.id) {
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

function violacaoUnicidadeOrdemServicoRodada(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === 'P2002'
  );
}
