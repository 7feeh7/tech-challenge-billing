import { randomUUID } from 'node:crypto';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_ORCAMENTO_REJEITADO,
  type PayloadOrcamentoRejeitado,
} from '@/shared/messaging/envelope';
import { OrcamentoNaoEncontradoError } from '../../domain/errors/orcamento.errors';
import {
  type OrcamentoOutput,
  OrcamentoOutputMapper,
} from '../mappers/orcamento-output.mapper';
import type { OrcamentoGateway } from '../ports/orcamento.gateway';

export interface RejeitarOrcamentoInput {
  motivo: string;
}

export class RejeitarOrcamentoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly orcamentos: OrcamentoGateway,
    private readonly outbox: OutboxGateway,
  ) {}

  async execute(
    id: string,
    input: RejeitarOrcamentoInput,
  ): Promise<OrcamentoOutput> {
    const orcamento = await this.orcamentos.buscarPorId(id);
    if (!orcamento) {
      throw new OrcamentoNaoEncontradoError(id);
    }

    orcamento.rejeitar(input.motivo);

    const atualizado = await this.unitOfWork.executar(async (contexto) => {
      const persistido = await this.orcamentos.atualizar(
        contexto,
        id,
        orcamento,
      );

      const evento: EnvelopeMensagem<PayloadOrcamentoRejeitado> = {
        eventId: randomUUID(),
        eventType: EVENTO_ORCAMENTO_REJEITADO,
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: orcamento.correlationId,
        causationId: null,
        ordemServicoId: orcamento.ordemServicoId,
        rodada: orcamento.rodada,
        payload: {
          orcamentoId: persistido.id as string,
          motivo: persistido.motivoRejeicao as string,
        },
      };

      await this.outbox.registrar(contexto, {
        eventId: evento.eventId,
        eventType: EVENTO_ORCAMENTO_REJEITADO,
        envelope: evento,
        correlationId: evento.correlationId,
        destino: DESTINO_FILA_OS,
      });

      return persistido;
    });

    return OrcamentoOutputMapper.toOutput(atualizado);
  }
}
