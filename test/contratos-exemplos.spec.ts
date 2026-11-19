import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const exemplosDir = join(__dirname, '..', 'docs', 'contratos', 'exemplos');

describe('Exemplos JSON dos contratos do Billing', () => {
  const arquivos = readdirSync(exemplosDir).filter((f) => f.endsWith('.json'));

  it.each(arquivos)('%s é JSON válido e contém eventType', (arquivo) => {
    const conteudo = readFileSync(join(exemplosDir, arquivo), 'utf-8');
    const envelope = JSON.parse(conteudo) as {
      eventType?: string;
      version?: number;
      source?: string;
    };

    expect(envelope.eventType).toMatch(/^billing\./);
    expect(envelope.version).toBe(1);
    expect(typeof envelope.source).toBe('string');
  });

  describe('billing.estorno-concluido.v1: campo aditivo origemEstorno', () => {
    const ler = (arquivo: string) =>
      JSON.parse(readFileSync(join(exemplosDir, arquivo), 'utf-8')) as {
        payload: Record<string, unknown>;
      };

    it.each([
      ['billing.estorno-concluido.v1.json', 'SEGUNDO_PAGAMENTO'],
      [
        'billing.estorno-concluido.pendencia-resolvida.v1.json',
        'PENDENCIA_RESOLVIDA',
      ],
    ])('%s traz origemEstorno %s', (arquivo, origem) => {
      expect(ler(arquivo).payload.origemEstorno).toBe(origem);
    });

    it('mantém o exemplo anterior, sem o campo, como compatibilidade', () => {
      const { payload } = ler('billing.estorno-concluido.sem-origem.v1.json');

      expect(payload).not.toHaveProperty('origemEstorno');
      expect(Object.keys(payload)).toEqual([
        'cobrancaId',
        'orderId',
        'valorEstornadoCentavos',
        'estornadoEm',
        'tipoEstorno',
        'statusOrderMercadoPago',
      ]);
    });

    it('o exemplo com origem acrescenta só o campo aditivo ao anterior', () => {
      const anterior = ler('billing.estorno-concluido.sem-origem.v1.json');
      const atual = ler('billing.estorno-concluido.v1.json');

      expect(atual.payload).toEqual({
        ...anterior.payload,
        origemEstorno: 'SEGUNDO_PAGAMENTO',
      });
    });
  });

  describe('billing.pagamento-confirmado.v1: campo aditivo origemPagamento', () => {
    const ler = (arquivo: string) =>
      JSON.parse(readFileSync(join(exemplosDir, arquivo), 'utf-8')) as {
        payload: Record<string, unknown>;
      };

    it.each([
      ['billing.pagamento-confirmado.v1.json', 'PAGAMENTO_LEGITIMO'],
      [
        'billing.pagamento-confirmado.segundo-pagamento.v1.json',
        'SEGUNDO_PAGAMENTO',
      ],
    ])('%s traz origemPagamento %s', (arquivo, origem) => {
      expect(ler(arquivo).payload.origemPagamento).toBe(origem);
    });

    it('mantém o exemplo anterior, sem o campo, como compatibilidade', () => {
      const { payload } = ler(
        'billing.pagamento-confirmado.sem-origem.v1.json',
      );

      expect(payload).not.toHaveProperty('origemPagamento');
      expect(Object.keys(payload)).toEqual([
        'cobrancaId',
        'orderId',
        'aprovadoEm',
        'valorCentavos',
      ]);
    });

    it('o exemplo com origem acrescenta só o campo aditivo ao anterior', () => {
      const anterior = ler('billing.pagamento-confirmado.sem-origem.v1.json');
      const atual = ler('billing.pagamento-confirmado.v1.json');

      expect(atual.payload).toEqual({
        ...anterior.payload,
        origemPagamento: 'PAGAMENTO_LEGITIMO',
      });
    });
  });

  describe('billing.pagamento-tardio-registrado.v1: tratamento', () => {
    it.each([
      ['billing.pagamento-tardio-registrado.v1.json', 'ESTORNO_AUTOMATICO'],
      [
        'billing.pagamento-tardio-registrado.pendencia-manual.v1.json',
        'PENDENCIA_MANUAL',
      ],
    ])('%s traz tratamento %s', (arquivo, tratamento) => {
      const envelope = JSON.parse(
        readFileSync(join(exemplosDir, arquivo), 'utf-8'),
      ) as { payload: { tratamento: string } };

      expect(envelope.payload.tratamento).toBe(tratamento);
    });
  });
});
