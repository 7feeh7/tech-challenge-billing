import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { Cobranca } from '../../domain/entities/cobranca.entity';

export interface CobrancaGateway {
  criar(contexto: ContextoTransacao, cobranca: Cobranca): Promise<Cobranca>;
  buscarPorOrcamentoId(orcamentoId: string): Promise<Cobranca | null>;
}
