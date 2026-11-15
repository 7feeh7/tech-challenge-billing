import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ResultadoCenario =
  | 'comprovado'
  | 'limitado'
  | 'indisponivel'
  | 'pendente';

export interface RegistroCenario {
  id: string;
  titulo: string;
  resultado: ResultadoCenario;
  decisoes: string[];
  requisicao?: Record<string, unknown>;
  resposta?: Record<string, unknown>;
  comportamento: string;
  observacoes?: string;
  hipoteseDocumentacao?: boolean;
}

export class RegistroExecucao {
  private readonly itens: RegistroCenario[] = [];
  private readonly inicio = new Date().toISOString();

  adicionar(item: RegistroCenario): void {
    this.itens.push(item);
  }

  listar(): RegistroCenario[] {
    return [...this.itens];
  }

  persistirJson(): string {
    const pasta = resolve(__dirname, '../resultados');
    mkdirSync(pasta, { recursive: true });
    const nome = `execucao-${this.inicio.replace(/[:.]/g, '-')}.json`;
    const caminho = resolve(pasta, nome);
    writeFileSync(
      caminho,
      JSON.stringify({ inicio: this.inicio, cenarios: this.itens }, null, 2),
      'utf8',
    );
    return caminho;
  }
}

export function aguardar(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export function extrairOrderId(corpo: unknown): string | undefined {
  if (!corpo || typeof corpo !== 'object') {
    return undefined;
  }
  const id = (corpo as { id?: string }).id;
  return typeof id === 'string' ? id : undefined;
}

export function extrairCheckoutUrl(corpo: unknown): string | undefined {
  if (!corpo || typeof corpo !== 'object') {
    return undefined;
  }
  const url = (corpo as { checkout_url?: string }).checkout_url;
  return typeof url === 'string' ? url : undefined;
}

export function extrairStatus(corpo: unknown): string | undefined {
  if (!corpo || typeof corpo !== 'object') {
    return undefined;
  }
  const status = (corpo as { status?: string }).status;
  return typeof status === 'string' ? status : undefined;
}

export function extrairPaymentTransactionId(
  corpo: unknown,
): string | undefined {
  if (!corpo || typeof corpo !== 'object') {
    return undefined;
  }
  const transactions = (
    corpo as { transactions?: { payments?: { id?: string }[] } }
  ).transactions;
  const pagamento = transactions?.payments?.[0];
  return typeof pagamento?.id === 'string' ? pagamento.id : undefined;
}
