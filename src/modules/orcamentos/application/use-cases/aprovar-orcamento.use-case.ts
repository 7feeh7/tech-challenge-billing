import { randomUUID } from 'node:crypto';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import {
  OrcamentoNaoEncontradoError,
  SituacaoOrcamentoInvalidaError,
} from '../../domain/errors/orcamento.errors';
import { SituacaoOrcamento } from '../../domain/situacao-orcamento';
import { OrcamentoOutputMapper } from '../mappers/orcamento-output.mapper';
import type { OrcamentoGateway } from '../ports/orcamento.gateway';
import type { ReservaOsGateway } from '../ports/reserva-os.gateway';
import type { ResultadoAplicacaoReserva } from '../services/aplicar-resultado-reserva.service';
import { AplicarResultadoReservaService } from '../services/aplicar-resultado-reserva.service';

export class AprovarOrcamentoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly orcamentos: OrcamentoGateway,
    private readonly reservaOs: ReservaOsGateway,
    private readonly aplicarResultado: AplicarResultadoReservaService,
    private readonly atrasoReprocessamentoMs = 10_000,
  ) {}

  async execute(id: string): Promise<ResultadoAplicacaoReserva> {
    const orcamento = await this.orcamentos.buscarPorId(id);
    if (!orcamento) {
      throw new OrcamentoNaoEncontradoError(id);
    }

    if (orcamento.situacao === SituacaoOrcamento.APROVACAO_EM_ANDAMENTO) {
      return {
        statusHttp: 202,
        orcamento: OrcamentoOutputMapper.toOutput(orcamento),
      };
    }

    if (orcamento.situacao === SituacaoOrcamento.APROVADO) {
      return {
        statusHttp: 200,
        orcamento: OrcamentoOutputMapper.toOutput(orcamento),
      };
    }

    if (orcamento.situacao !== SituacaoOrcamento.GERADO) {
      throw new SituacaoOrcamentoInvalidaError(orcamento.situacao, 'aprovar');
    }

    const emAndamento = await this.unitOfWork.executar(async (contexto) =>
      this.orcamentos.iniciarAprovacaoSeGerado(contexto, id),
    );

    if (!emAndamento) {
      const atual = await this.orcamentos.buscarPorId(id);
      if (atual?.situacao === SituacaoOrcamento.APROVACAO_EM_ANDAMENTO) {
        return {
          statusHttp: 202,
          orcamento: OrcamentoOutputMapper.toOutput(atual),
        };
      }
      if (atual?.situacao === SituacaoOrcamento.APROVADO) {
        return {
          statusHttp: 200,
          orcamento: OrcamentoOutputMapper.toOutput(atual),
        };
      }
      throw new SituacaoOrcamentoInvalidaError(
        atual?.situacao ?? '?',
        'aprovar',
      );
    }

    const resultado = await this.reservaOs.reservar({
      ordemServicoId: emAndamento.ordemServicoId,
      rodada: emAndamento.rodada,
      orcamentoId: id,
      tentativaAprovacao: emAndamento.tentativaAprovacao,
      correlationId: emAndamento.correlationId,
      requestId: randomUUID(),
    });

    return await this.aplicarResultado.aplicar(emAndamento, resultado);
  }

  async reprocessarPendente(orcamentoId: string): Promise<void> {
    const orcamento = await this.orcamentos.buscarPorId(orcamentoId);
    if (!orcamento) return;
    if (orcamento.situacao !== SituacaoOrcamento.APROVACAO_EM_ANDAMENTO) return;
    if (
      !orcamento.bloqueadoAprovacaoAte ||
      orcamento.bloqueadoAprovacaoAte <= new Date()
    ) {
      return;
    }

    const resultado = await this.reservaOs.reservar({
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      orcamentoId: orcamentoId,
      tentativaAprovacao: orcamento.tentativaAprovacao,
      correlationId: orcamento.correlationId,
      requestId: randomUUID(),
    });

    try {
      const aplicado = await this.aplicarResultado.aplicar(
        orcamento,
        resultado,
        {
          liberarBloqueioEmIndeterminado: false,
        },
      );
      if (aplicado.statusHttp === 202) {
        await this.orcamentos.adiarBloqueioAprovacao(
          orcamentoId,
          this.atrasoReprocessamentoMs,
        );
      }
    } catch {
      await this.orcamentos.adiarBloqueioAprovacao(
        orcamentoId,
        this.atrasoReprocessamentoMs,
      );
    }
  }
}
