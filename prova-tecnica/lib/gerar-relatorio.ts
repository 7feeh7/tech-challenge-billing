import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RegistroCenario } from './registro';

function linhaCenario(c: RegistroCenario): string {
  const doc = c.hipoteseDocumentacao
    ? ' *(hipótese/documentação; não comprovado em runtime)*'
    : '';
  return [
    `### ${c.id} — ${c.titulo}`,
    '',
    `- **Resultado:** ${c.resultado}${doc}`,
    `- **Decisões:** ${c.decisoes.join(', ')}`,
    `- **Comportamento:** ${c.comportamento}`,
    c.observacoes ? `- **Observações:** ${c.observacoes}` : '',
    '',
    '<details>',
    '<summary>Requisição/resposta sanitizadas</summary>',
    '',
    '```json',
    JSON.stringify({ requisicao: c.requisicao, resposta: c.resposta }, null, 2),
    '```',
    '',
    '</details>',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function gerarRelatorioMd(
  cenarios: RegistroCenario[],
  extra?: { impedimentos?: string[]; pendentesE05?: string[] },
): void {
  const comprovados = cenarios.filter((c) => c.resultado === 'comprovado');
  const pendentes = cenarios.filter((c) => c.resultado === 'pendente');
  const limitados = cenarios.filter((c) => c.resultado === 'limitado');
  const indisponiveis = cenarios.filter((c) => c.resultado === 'indisponivel');

  const corpo = [
    '# RELATORIO — E04 Prova técnica Mercado Pago (Orders API)',
    '',
    'Ambiente **teste**; sem webhook (escopo E05).',
    '',
    '## Checkout manual (cenários C06–C10)',
    '',
    'Conclua **nesta ordem** (cartões de teste MP; titular no formulário):',
    '',
    '1. **C06 APRO** — aprovado: titular `APRO`, doc `12345678`, cartão Mastercard teste `5031 7557 3453 0604`, CVV `123`, validade `11/30`.',
    '2. **C07 FUND** — recusado: titular `FUND`, mesmo cartão.',
    '3. **C10 parcial** — aprovado (APRO) em order dedicada **antes** de estorno total na C06.',
    '',
    'Depois adicione em `prova-tecnica/.env` (sem commitar):',
    '',
    '```',
    'MP_ORDER_PAGA_ID=<id da order C06 após APRO>',
    'MP_ORDER_RECUSADA_ID=<id da order C07 após FUND>',
    'MP_ORDER_PARCIAL_ID=<id da order de R$ 250 após APRO>',
    '```',
    '',
    'Rode de novo: `yarn prova-tecnica`.',
    '',
    '## Resumo',
    '',
    `| Resultado | Qtd |`,
    `| --- | --- |`,
    `| Comprovado | ${comprovados.length} |`,
    `| Limitado | ${limitados.length} |`,
    `| Pendente | ${pendentes.length} |`,
    `| Indisponível | ${indisponiveis.length} |`,
    '',
    '## Cenários',
    '',
    ...cenarios.map(linhaCenario),
    '## Impactos em contratos e decisões',
    '',
    '- **D3.15:** Orders API utilizada exclusivamente (`POST/GET /v1/orders`, cancel, refund).',
    '- **D4.6:** `expiration_time` ISO 8601 — ver C05b e C05.',
    '- **D4.5 / D1.15:** Cancelamento sem pagamento comprovável por API; confirmação de pagamento exige consulta GET (C03/C06).',
    '- **E05:** Webhook, assinatura `x-signature` e contratos financeiros permanecem pendentes.',
    '',
    '## Limitações e diferenças doc × runtime',
    '',
    '- Checkout Pro exige fluxo no navegador para aprovar/recusar cartão; a API sozinha não simula pagamento.',
    '- Estorno parcial/total pode falhar por saldo da conta de teste (documentação MP).',
    '- Status finais podem variar (`processed`, `paid`, `canceled`) — mapear na E17.',
    '',
    '## Pendências para E05',
    '',
    ...(
      extra?.pendentesE05 ?? [
        'Webhook `orders_v2` e validação HMAC.',
        'Política de reenvio do MP em teste.',
        'Evento de order expirada vs. consulta periódica.',
        'Contratos financeiros `billing.*` após consolidar status reais.',
      ]
    ).map((p) => `- ${p}`),
    '',
  ];

  if (extra?.impedimentos?.length) {
    corpo.push(
      '## Impedimentos',
      '',
      ...extra.impedimentos.map((i) => `- ${i}`),
      '',
    );
  }

  const caminho = resolve(__dirname, '../RELATORIO.md');
  writeFileSync(caminho, corpo.join('\n'), 'utf8');
}
