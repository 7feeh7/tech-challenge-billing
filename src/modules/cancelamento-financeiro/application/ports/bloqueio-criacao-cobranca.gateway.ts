import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

export interface BloqueioCriacaoCobrancaGateway {
  existe(ordemServicoId: string, rodada: number): Promise<boolean>;
  garantir(
    contexto: ContextoTransacao,
    ordemServicoId: string,
    rodada: number,
    motivo?: string | null,
  ): Promise<void>;
}
