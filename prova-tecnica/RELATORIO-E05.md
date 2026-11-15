# RELATORIO — E05 Prova técnica Mercado Pago (webhook e contratos financeiros)

Ambiente **teste**; endpoint local `POST /v1/webhooks/mercado-pago`; tópico painel `orders_v2`.

## Resumo (atualizado — sessão túnel 2026-11-15)

| Classe | Cenários |
| --- | --- |
| **Comprovado (runtime)** | W01, W05, **W06**, **W08** (GET `canceled`/`expired`) |
| **Comprovado (Jest/script local)** | W02, W04, W03 (só `yarn prova-tecnica-e05`, não painel) |
| **Limitado** | **W03** (histórico painel vazio); **W07** (409 reproduzido, reenvio mesma chave não ecoa HTTP); **webhooks** (lacunas vs GET — ver § Confronto) |
| **Pendente** | Nenhum cenário W01–W08 bloqueado para fechamento da E05 (lacunas documentadas) |

**Decisão D3.15:** mantida — Orders API como conciliação obrigatória; webhook e idempotência HTTP **sem** garantias observadas na prova (ver `docs/contratos/mensagens-billing.md`).

### Infra local (encerrada — fim E05)

| Componente | Estado |
| --- | --- |
| cloudflared | **Encerrado** (túnel quick inativo) |
| Proxy (:8787) | **Encerrado** |
| Billing (`:3000`) | **Encerrado** |
| URL pública antiga | `detector-shopzilla-clinical-commonwealth.trycloudflare.com` — **inacessível** (curl falha após parada) |

**Autor:** remover URL do webhook no [painel Developers](https://www.mercadopago.com.br/developers/panel/app) se ainda cadastrada.

## Cenários webhook (W01–W08)

| ID | Cenário | Resultado | Evidência |
| --- | --- | --- | --- |
| W01 | Webhook `orders_v2` + HMAC (`order.processed`) | **comprovado (runtime)** | Painel sucesso 2026-11-15 22:15Z; jsonl; sem 401/503 no painel = HMAC OK + **HTTP 200** |
| W01b | Classificação da entrega | **simulação painel** | Payload MP com `live_mode: false` (não é webhook pós-checkout) |
| W02 | Assinatura inválida | comprovado | `validar-assinatura-webhook.service.spec.ts` + controller spec → 401 |
| W03 | Notificação duplicada (mesmo `x-request-id`) | **limitado** | Histórico painel **vazio**; **não** tratar segunda notificação pós-checkout (outro `requestId`) como reenvio; dedup runtime pendente; coberto por testes + `yarn prova-tecnica-e05` |
| W04 | Reenvio após não-2xx | comprovado (simulado) | `prova_simular_falha=1` → 503; reenvio → 200 |
| W05 | Conciliação GET order após webhook | **comprovado (runtime)** | Handler GET sempre; ver **lição W06** abaixo |
| W06 | FUND depois APRO na mesma order | **comprovado (runtime)** | Order única `ORDTST01M7GMMTFB6C17A37RM207XAST`; mesmo `checkout_url`; GET: tentativa 1 `failed`/`insufficient_amount`, tentativa 2 `processed`/`accredited`; script `e05-w06-w08-2026-11-15T22-27-59-829Z.json` |
| W07 | Estorno parcial + total; 409 + mesma chave | **limitado** | Order `ORDTST01M7GN83QJJAV9NGEC9GFKJAXB`: pagamento comprovado; GET final `refunded`/`refunded`, 2 refunds; parcial R$ 50 + total; 1ª total **409**; reenvio **mesma** chave **201** (≠ eco 409); sem nova chave forçada; `e05-w06-w08-2026-11-15T22-36-12-423Z.json` |
| W08 | Expiração sem pagamento | **comprovado** (GET) / **limitado** (webhook) | Order `ORDTST01M7GNBWWHQWBXS25MMP4GT6K3` `PT3M`; após ~5,5 min GET `canceled`/`expired` (poll pós-script); **nenhum** webhook no jsonl |

### Lição W06 — `order.processed` × situação financeira

Após **FUND**, o Mercado Pago enviou webhook com `acao: order.processed` (`requestId` `34a92277-…`), enquanto o GET na order estava `action_required`/`waiting_retry` com pagamento `failed`/`insufficient_amount`. **Não** usar só o tópico/ação do webhook para fechar financeiro: **consultar Orders API** (como no handler E05: `situacaoFinanceira` após GET). Pós-APRO, jsonl ainda pode não listar segunda entrega; aprovação comprovada pelo GET com duas linhas em `transactions.payments`. **Verificado 2026-11-15 pós-W07/W08:** segue **sem** segunda linha para W06 (APRO); **sem** linhas para W07 (pagamento/estorno) ou W08 (expiração).

### Confronto webhook (jsonl) × GET Orders API

| Order / evento | jsonl | GET (autoridade) |
| --- | --- | --- |
| W01 simulação painel | 1× `order.processed` | Alinhado na simulação |
| W06 pós-FUND | 1× `order.processed` | Na época: `action_required` — **desalinhado** |
| W06 pós-APRO | **não recebido** | `processed`/`accredited` |
| W07 APRO + estornos | **não recebido** | `processed` → `refunded` |
| W08 expiração | **não recebido** | `canceled`/`expired` |

Conclusão E05: manter **GET conciliação** no handler (W05) e não fechar financeiro só pelo webhook.

### Entregas webhook — como diferenciar

| Origem | Onde aparece | Como reconhecer |
| --- | --- | --- |
| Simulação painel | jsonl `origem: mercado_pago` | Corpo MP com `live_mode: false` (como na simulação W01) |
| Checkout / order real | jsonl `origem: mercado_pago` | `live_mode: true` (conta teste) + order W06/W07/W08 |
| Script local E05 | jsonl via `persistir-entrega-webhook.ts` | Campo `origem: script_local` + HMAC gerado por nós |

## Contratos financeiros fechados (`docs/contratos/exemplos/`)

| eventType | Observação |
| --- | --- |
| `billing.cobranca-criada.v1` | `orderId` obrigatório; sem reemissão por recusa (D1.15) |
| `billing.pagamento-confirmado.v1` | `orderId`, `aprovadoEm`, `valorCentavos` |
| `billing.cobranca-expirada.v1` | Inclui `statusOrderMercadoPago` / `status_detail` observados (`canceled`/`expired`) |
| `billing.pagamento-tardio-registrado.v1` | Exemplo com `ESTORNO_AUTOMATICO` (fluxo E17) |
| `billing.estorno-concluido.v1` | `statusOrderMercadoPago: refunded` |
| `billing.consultar-situacao-financeira.v1` | `finalidade` do spec |
| `billing.situacao-financeira.v1` | Dois exemplos: `PAGO_NO_PRAZO` e `INDETERMINADA` |

Status Mercado Pago nos contratos e na implementação usam valores **observados** na E04/E05 (`processed`, `action_required`, `waiting_retry`, `partially_refunded`, `refunded`) — **não** `failed` na order para recusa.

## D3.11 — item não impeditivo

| Item | Limitação | Alternativa |
| --- | --- | --- |
| Webhook `orders_v2` (APRO, estorno, expiração) | Várias transições **sem** linha em `webhook-entregas.jsonl` (túnel ativo) | GET order + job conciliação (E04 C05, D4.5); W08 expirou só no GET |
| Histórico de entregas no painel Webhooks | Lista vazia; simulação e checkout reportam sucesso no destino | W03 sem reenvio manual; **não** equivaler nova notificação (outro `x-request-id`) a deduplicação; script `prova-tecnica-e05` para W03 |

## Comandos locais (aceite — reexecutados ao encerrar E05)

| Comando | Resultado |
| --- | --- |
| `yarn lint` | OK |
| `yarn build` | OK |
| `yarn test:cov` | OK (branches 82,19%; stmts 90,95%) |
| `yarn test:e2e` | OK |
| `terraform fmt -check -recursive && terraform init -backend=false && terraform validate` | OK |

## Artefatos e segredos

- `prova-tecnica/resultados/*`: IDs de order de teste; `client_token` como `[redacted]` nos JSON sanitizados.
- `.env` e `prova-tecnica/.env`: ignorados pelo `.gitignore` (confirmado `git check-ignore`).
- Evidências E05: `webhook-entregas.jsonl`, `e05-w06-w08-*.json`, `RELATORIO-E05.md`, contratos em `docs/contratos/`.

## Painel Mercado Pago (autor — antes do túnel)

1. [Developers](https://www.mercadopago.com.br/developers/panel/app) → aplicação de **teste**.
2. **Webhooks** → **Configurar notificações**.
3. **URL de produção/teste:** `https://<host-do-túnel>/v1/webhooks/mercado-pago` (somente este path).
4. Evento **Orders** → `orders_v2`.
5. **Assinatura secreta:** gere/copie o segredo e grave **o mesmo valor** em:
   - `prova-tecnica/.env` → `MP_WEBHOOK_SECRET`
   - variável do Billing local → `MP_WEBHOOK_SECRET`
   - (implantação) Secrets Manager runbook 7.2
6. Salve. Use **Enviar teste** e confira HTTP 200 no Billing.

## Túnel local (sessão de prova)

```bash
# Terminal 1 — Billing (raiz do repositório)
MP_WEBHOOK_SECRET=<segredo-do-painel> MP_WEBHOOK_PROVA_HABILITADA=true yarn start

# Terminal 2 — túnel (exemplo cloudflared)
cloudflared tunnel --url http://127.0.0.1:3000
```

Use a URL `https://*.trycloudflare.com` **somente** no webhook. Ao terminar: pare o túnel e **remova a URL** no painel (passo 3).

## Prova automatizada local

```bash
# Mesmo segredo no Billing e em prova-tecnica/.env
yarn prova-tecnica-e05
```

## Impedimentos nesta sessão

| ID | Descrição |
| --- | --- |
| — | Lacunas: W03 painel; entrega webhook incompleta pós-FUND; W07 idempotência HTTP |

## Saída — E05 (evidências até 2026-11-15, fim de sessão W07/W08)

### Comprovado

- Endpoint webhook + HMAC (W01 runtime) e GET pós-notificação (W05/W06)
- W06 FUND→APRO mesma order/checkout (`ORDTST01M7GMMTFB6C17A37RM207XAST`)
- W07 fluxo financeiro: APRO em `ORDTST01M7GN83QJJAV9NGEC9GFKJAXB`, parcial + total, GET `refunded`
- W08 expiração por GET (`ORDTST01M7GNBWWHQWBXS25MMP4GT6K3` → `canceled`/`expired`)
- Contratos `billing.*` v1, Terraform SM contêiner, aceite `lint/build/test/e2e/terraform`

### Limitado

- **W03:** histórico painel vazio; dedup só testes/script local
- **W07 D3.15:** 409 na 1ª estorno total após parcial **sim**; reenvio com **mesma** chave retornou **201** (não repete 409); estado final único `refunded` — implementação deve continuar consultando GET antes de nova chave
- **Webhooks:** jsonl com 2 entradas apenas; W06 APRO tardio **não** chegou; estornos e expiração **sem** webhook registrado

### Pendente

- Nenhum item impeditivo para encerrar E05 no escopo da prova (limitações acima na Saída e em D3.11)

## Saídas para E17–E19

- Contratos financeiros v1 em `docs/contratos/`
- Endpoint mínimo webhook em `src/modules/webhook-mercado-pago/`
- Contêiner SM `terraform/mercado-pago-secret.tf` (`mercado_pago_secret_arn`)
- Política estorno: após 409, tentar **mesma** chave e validar GET; nova chave só se GET mostrar efeito ausente (W07 limitado: 409 depois 201 mesma chave); ver E04 C09