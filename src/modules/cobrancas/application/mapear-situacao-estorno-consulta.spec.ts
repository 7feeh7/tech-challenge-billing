import { SituacaoCobranca } from '../domain/situacao-cobranca';
import { mapearSituacaoEstornoConsulta } from './mapear-situacao-estorno-consulta';

describe('mapearSituacaoEstornoConsulta', () => {
  it('retorna NENHUM para order cancelada sem estorno', () => {
    expect(
      mapearSituacaoEstornoConsulta({
        order: { id: '1', status: 'canceled', pagamentos: [] },
        situacaoCobranca: SituacaoCobranca.PENDENTE,
      }),
    ).toBe('NENHUM');
  });

  it('retorna EM_ANDAMENTO quando cobrança em estorno', () => {
    expect(
      mapearSituacaoEstornoConsulta({
        order: { id: '1', status: 'processed', pagamentos: [] },
        situacaoCobranca: SituacaoCobranca.ESTORNO_EM_ANDAMENTO,
      }),
    ).toBe('EM_ANDAMENTO');
  });

  it('retorna REALIZADO para order refunded', () => {
    expect(
      mapearSituacaoEstornoConsulta({
        order: { id: '1', status: 'refunded', pagamentos: [] },
        situacaoCobranca: SituacaoCobranca.PENDENTE,
      }),
    ).toBe('REALIZADO');
  });
});
