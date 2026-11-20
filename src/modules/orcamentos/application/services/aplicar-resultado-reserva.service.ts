import type { BloqueioCriacaoCobrancaGateway } from '@/modules/cancelamento-financeiro/application/ports/bloqueio-criacao-cobranca.gateway';
import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import { Cobranca } from '@/modules/cobrancas/domain/entities/cobranca.entity';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import { Orcamento } from '../../domain/entities/orcamento.entity';
import {
  AprovacaoEncerradaError,
  EstadoIncompativelAprovacaoError,
  EstoqueInsuficienteAprovacaoError,
} from '../../domain/errors/orcamento.errors';
import { SituacaoOrcamento } from '../../domain/situacao-orcamento';
import { calcularPrazoPagamento } from '../calcular-prazo-pagamento';
import {
  type OrcamentoOutput,
  OrcamentoOutputMapper,
} from '../mappers/orcamento-output.mapper';
import type { OrcamentoGateway } from '../ports/orcamento.gateway';
import type { ResultadoReservaOs } from '../ports/reserva-os.gateway';

export interface OpcoesAplicarResultadoReserva {
  liberarBloqueioEmIndeterminado?: boolean;
}

export interface ResultadoAplicacaoReserva {
  statusHttp: 200 | 202;
  orcamento: OrcamentoOutput;
}

export class AplicarResultadoReservaService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly orcamentos: OrcamentoGateway,
    private readonly cobrancas: CobrancaGateway,
    private readonly bloqueios: BloqueioCriacaoCobrancaGateway,
    private readonly carenciaMinutos: number,
  ) {}

  async aplicar(
    orcamentoBase: Orcamento,
    resultado: ResultadoReservaOs,
    opcoes: OpcoesAplicarResultadoReserva = {},
  ): Promise<ResultadoAplicacaoReserva> {
    const liberarBloqueioEmIndeterminado =
      opcoes.liberarBloqueioEmIndeterminado ?? true;

    if (resultado.tipo === 'indeterminado') {
      if (liberarBloqueioEmIndeterminado) {
        await this.orcamentos.liberarBloqueioAprovacao(
          orcamentoBase.id as string,
        );
      }
      const atual = await this.orcamentos.buscarPorId(
        orcamentoBase.id as string,
      );
      return {
        statusHttp: 202,
        orcamento: OrcamentoOutputMapper.toOutput(atual ?? orcamentoBase),
      };
    }

    if (resultado.tipo === 'conflito') {
      const estadoAtual = await this.orcamentos.buscarPorId(
        orcamentoBase.id as string,
      );
      if (estadoAtual && this.respostaObsoleta(estadoAtual, orcamentoBase)) {
        return {
          statusHttp:
            estadoAtual.situacao === SituacaoOrcamento.APROVADO ? 200 : 202,
          orcamento: OrcamentoOutputMapper.toOutput(estadoAtual),
        };
      }

      await this.unitOfWork.executar(async (contexto) => {
        const atual = await this.orcamentos.buscarPorId(
          orcamentoBase.id as string,
        );
        if (!atual || this.respostaObsoleta(atual, orcamentoBase)) return;
        const orcamento = this.clonarParaAtualizacao(atual);

        if (
          resultado.codigo === 'OS_EM_CANCELAMENTO' ||
          resultado.codigo === 'RODADA_OBSOLETA'
        ) {
          orcamento.encerrarAprovacao();
        } else {
          orcamento.voltarParaGerado();
        }

        await this.orcamentos.atualizar(
          contexto,
          orcamento.id as string,
          orcamento,
        );
      });

      if (resultado.codigo === 'ESTOQUE_INSUFICIENTE') {
        throw new EstoqueInsuficienteAprovacaoError();
      }
      if (resultado.codigo === 'ESTADO_INCOMPATIVEL') {
        throw new EstadoIncompativelAprovacaoError();
      }
      if (
        resultado.codigo === 'OS_EM_CANCELAMENTO' ||
        resultado.codigo === 'RODADA_OBSOLETA'
      ) {
        throw new AprovacaoEncerradaError(resultado.codigo);
      }
      throw new Error(`Conflito de reserva não tratado: ${resultado.codigo}`);
    }

    const persistido = await this.unitOfWork.executar(async (contexto) => {
      const atual = await this.orcamentos.buscarPorId(
        orcamentoBase.id as string,
      );
      if (!atual) {
        throw new Error('Orçamento não encontrado ao concluir aprovação.');
      }
      if (this.respostaObsoleta(atual, orcamentoBase)) {
        return atual;
      }
      const orcamento = this.clonarParaAtualizacao(atual);
      orcamento.concluirAprovacao(
        resultado.reservaId,
        resultado.prazoReferencia,
      );

      const salvo = await this.orcamentos.atualizar(
        contexto,
        orcamento.id as string,
        orcamento,
      );

      const prazoPagamento = calcularPrazoPagamento(
        resultado.prazoReferencia,
        this.carenciaMinutos,
      );
      const bloqueado = await this.bloqueios.existe(
        salvo.ordemServicoId,
        salvo.rodada,
      );
      if (bloqueado) {
        return salvo;
      }
      await this.cobrancas.criar(
        contexto,
        Cobranca.criarIntencaoAPartirDoOrcamento({
          orcamentoId: salvo.id as string,
          ordemServicoId: salvo.ordemServicoId,
          rodada: salvo.rodada,
          clienteId: salvo.clienteId,
          correlationId: salvo.correlationId,
          valorTotalCentavos: salvo.valorTotalCentavos,
          prazoPagamento,
        }),
      );

      return salvo;
    });

    if (persistido.situacao !== SituacaoOrcamento.APROVADO) {
      return {
        statusHttp: 202,
        orcamento: OrcamentoOutputMapper.toOutput(persistido),
      };
    }

    return {
      statusHttp: 200,
      orcamento: OrcamentoOutputMapper.toOutput(persistido),
    };
  }

  private respostaObsoleta(atual: Orcamento, base: Orcamento): boolean {
    if (atual.situacao === SituacaoOrcamento.APROVADO) {
      return true;
    }
    return (
      atual.tentativaAprovacao !== base.tentativaAprovacao ||
      atual.situacao !== SituacaoOrcamento.APROVACAO_EM_ANDAMENTO
    );
  }

  private clonarParaAtualizacao(orcamento: Orcamento): Orcamento {
    return new Orcamento({
      id: orcamento.id,
      ordemServicoId: orcamento.ordemServicoId,
      rodada: orcamento.rodada,
      clienteId: orcamento.clienteId,
      correlationId: orcamento.correlationId,
      valorTotalCentavos: orcamento.valorTotalCentavos,
      situacao: orcamento.situacao,
      motivoRejeicao: orcamento.motivoRejeicao,
      tentativaAprovacao: orcamento.tentativaAprovacao,
      prazoReferencia: orcamento.prazoReferencia,
      reservaId: orcamento.reservaId,
      aprovadoEm: orcamento.aprovadoEm,
      bloqueadoAprovacaoAte: orcamento.bloqueadoAprovacaoAte,
      rejeitadoEm: orcamento.rejeitadoEm,
      criadoEm: orcamento.criadoEm,
      itens: orcamento.itens.map((item) => ({
        tipo: item.tipo,
        itemId: item.itemId,
        nome: item.nome,
        quantidade: item.quantidade,
        precoUnitarioCentavos: item.precoUnitarioCentavos,
      })),
    });
  }
}
