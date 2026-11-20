import type { SituacaoEstornoConsulta } from '@/shared/messaging/envelope';
import { interpretarEstornoOrder } from '../domain/interpretar-estorno-order';
import type { OrderMercadoPagoConsultada } from '../domain/interpretar-situacao-order';
import { SituacaoCobranca } from '../domain/situacao-cobranca';

export function mapearSituacaoEstornoConsulta(params: {
  order: OrderMercadoPagoConsultada;
  situacaoCobranca: SituacaoCobranca;
}): SituacaoEstornoConsulta {
  if (params.situacaoCobranca === SituacaoCobranca.ESTORNO_EM_ANDAMENTO) {
    return 'EM_ANDAMENTO';
  }
  if (
    params.situacaoCobranca === SituacaoCobranca.ESTORNADA ||
    params.situacaoCobranca === SituacaoCobranca.PENDENCIA_MANUAL
  ) {
    return 'REALIZADO';
  }

  const estorno = interpretarEstornoOrder(params.order);
  if (
    estorno.tipo === 'estorno_integral' ||
    estorno.tipo === 'estorno_parcial'
  ) {
    return 'REALIZADO';
  }
  if (estorno.tipo === 'sem_estorno') {
    return 'NENHUM';
  }
  return 'INDETERMINADO';
}
