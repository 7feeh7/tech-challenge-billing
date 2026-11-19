import type {
  ContextoTransacao,
  UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { Cobranca } from '../../domain/entities/cobranca.entity';
import { SituacaoCobranca } from '../../domain/situacao-cobranca';
import type { CobrancaGateway } from '../ports/cobranca.gateway';
import type { EstornoAutomaticoGateway } from '../ports/estorno-automatico.gateway';
import { clonarCobranca } from './clonar-cobranca';
import type { ExecutarEstornoAutomaticoService } from './executar-estorno-automatico.service';

export class TratarPagamentoTardioService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cobrancas: CobrancaGateway,
    private readonly estornos: EstornoAutomaticoGateway,
    private readonly executarEstorno: ExecutarEstornoAutomaticoService,
  ) {}

  // O estorno fica registrado por order, com chave de idempotência persistida:
  // repetições deste tratamento retomam o mesmo estorno em vez de abrir outro.
  // `PagamentoTardioRegistrado` só sai depois do estorno integral confirmado
  // (ou da pendência manual), dentro de `ExecutarEstornoAutomaticoService`.
  async tratar(params: {
    cobrancaId: string;
    posseAte: Date | null;
    orderId: string;
    aprovadoEm: Date;
  }): Promise<void> {
    const cobranca = await this.cobrancas.buscarPorId(params.cobrancaId);
    if (!cobranca?.id) return;

    const estornoId = await this.unitOfWork.executar(async (ctx) => {
      const { estorno } = await this.estornos.registrarSeNovo(ctx, {
        cobrancaId: params.cobrancaId,
        orderMercadoPagoId: params.orderId,
        tipo: 'PAGAMENTO_TARDIO',
        valorCentavos: cobranca.valorTotalCentavos,
        aprovadoEm: params.aprovadoEm,
      });
      await this.liberarBloqueio(ctx, cobranca, params.posseAte);
      return estorno.situacao === 'EM_ANDAMENTO' ? estorno.id : null;
    });
    if (!estornoId) return;

    await this.executarEstorno.executar(estornoId);
  }

  private async liberarBloqueio(
    ctx: ContextoTransacao,
    cobranca: Cobranca,
    posseAte: Date | null,
  ): Promise<void> {
    const copia = clonarCobranca(cobranca);
    copia.liberarBloqueioConciliacao();
    if (posseAte) {
      await this.cobrancas.atualizarSePosse(
        ctx,
        cobranca.id as string,
        copia,
        posseAte,
      );
      return;
    }
    await this.cobrancas.atualizar(ctx, cobranca.id as string, copia);
  }

  // INTENCAO com order já registrada ocorre quando a criação da order perde a
  // posse depois de gravar a order: a cobrança nunca chegou a PENDENTE e não
  // pode ser confirmada, então o pagamento é estornado como tardio.
  deveTratarPagamentoTardio(cobranca: Cobranca, aprovadoEm: Date): boolean {
    if (
      cobranca.situacao === SituacaoCobranca.EXPIRADA ||
      cobranca.situacao === SituacaoCobranca.CANCELADA ||
      cobranca.situacao === SituacaoCobranca.INTENCAO
    ) {
      return true;
    }
    return (
      cobranca.situacao === SituacaoCobranca.PENDENTE &&
      aprovadoEm.getTime() > cobranca.prazoPagamento.getTime()
    );
  }
}
