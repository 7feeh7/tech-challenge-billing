import { rastreamentoDoErro, serializarFalhaItemLote } from './falha-item-lote';

describe('serializarFalhaItemLote', () => {
  it('serializa o contexto técnico e só o tipo do erro', () => {
    const json = serializarFalhaItemLote(
      {
        processador: 'ProcessadorX',
        itemId: 'i1',
        ordemServicoId: 'os1',
        rodada: 2,
        correlationId: 'corr',
      },
      new TypeError('dado sensível da operação'),
    );

    expect(JSON.parse(json)).toEqual({
      evento: 'falha_item_lote',
      processador: 'ProcessadorX',
      itemId: 'i1',
      ordemServicoId: 'os1',
      rodada: 2,
      correlationId: 'corr',
      erro: 'TypeError',
    });
    expect(json).not.toContain('sensível');
  });

  it('omite o contexto ausente e descreve erro que não é Error pelo tipo', () => {
    const json = serializarFalhaItemLote(
      { processador: 'ProcessadorX', itemId: 'i1' },
      'texto solto',
    );

    expect(JSON.parse(json)).toEqual({
      evento: 'falha_item_lote',
      processador: 'ProcessadorX',
      itemId: 'i1',
      erro: 'string',
    });
  });
});

describe('rastreamentoDoErro', () => {
  it('devolve o rastreamento de um Error', () => {
    const erro = new Error('falha');

    expect(rastreamentoDoErro(erro)).toBe(erro.stack);
  });

  it('devolve undefined quando o valor não é um Error', () => {
    expect(rastreamentoDoErro('texto')).toBeUndefined();
  });
});
