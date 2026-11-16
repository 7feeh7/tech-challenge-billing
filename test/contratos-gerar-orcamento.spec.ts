import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Orcamento } from '../src/modules/orcamentos/domain/entities/orcamento.entity';
import type {
  EnvelopeMensagem,
  PayloadGerarOrcamento,
} from '../src/shared/messaging/envelope';
import { validarEnvelopeBase } from '../src/shared/messaging/validar-envelope';

describe('Contrato billing.gerar-orcamento.v1', () => {
  const arquivo = join(
    process.cwd(),
    'docs/contratos/exemplos/billing.gerar-orcamento.v1.json',
  );
  const envelope = JSON.parse(readFileSync(arquivo, 'utf-8'));

  it('exemplo é envelope válido e gera valor consistente', () => {
    validarEnvelopeBase(envelope);
    const tipado = envelope as EnvelopeMensagem<PayloadGerarOrcamento>;

    const orcamento = new Orcamento({
      ordemServicoId: tipado.ordemServicoId,
      rodada: tipado.rodada,
      clienteId: tipado.payload.clienteId,
      correlationId: tipado.correlationId,
      itens: tipado.payload.itens,
    });

    const somaItens = tipado.payload.itens.reduce(
      (s, i) => s + i.quantidade * i.precoUnitarioCentavos,
      0,
    );

    expect(orcamento.valorTotalCentavos).toBe(somaItens);
    expect(orcamento.valorTotalCentavos).toBe(15000);
  });
});
