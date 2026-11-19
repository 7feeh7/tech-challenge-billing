export interface ContextoFalhaItemLote {
  processador: string;
  itemId: string;
  ordemServicoId?: string;
  rodada?: number;
  correlationId?: string;
}

// Só o tipo do erro entra no JSON: a mensagem pode carregar dados da operação.
// O rastreamento completo vai ao logger como segundo argumento.
export function serializarFalhaItemLote(
  contexto: ContextoFalhaItemLote,
  erro: unknown,
): string {
  return JSON.stringify({
    evento: 'falha_item_lote',
    processador: contexto.processador,
    itemId: contexto.itemId,
    ordemServicoId: contexto.ordemServicoId,
    rodada: contexto.rodada,
    correlationId: contexto.correlationId,
    erro: erro instanceof Error ? erro.name : typeof erro,
  });
}

export function rastreamentoDoErro(erro: unknown): string | undefined {
  return erro instanceof Error ? erro.stack : undefined;
}
