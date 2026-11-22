# tech-challenge-billing

Billing Service da oficina mecânica: orçamentos, cobranças via Mercado Pago, estornos e pendências financeiras. Projeto do Tech Challenge (FIAP).

Na **Fase 4** é um dos seis repositórios independentes. O Billing executa os comandos financeiros enviados pelo OS Service, que orquestra a SAGA, e devolve os fatos (orçamento gerado, pagamento confirmado, estorno concluído etc.).

## Tecnologias

| Tecnologia      | Uso                                   |
| --------------- | ------------------------------------- |
| NestJS 11       | Framework, com Fastify                |
| TypeScript      | Linguagem (Node.js 24)                |
| Prisma 7        | ORM e migrations                      |
| PostgreSQL      | Banco de dados (RDS em produção)      |
| Amazon SQS      | Comandos recebidos e fatos publicados |
| Mercado Pago    | Orders API (link de checkout)         |
| Jest 30 + Biome | Testes e lint                         |
| Terraform       | Fila `billing-in`, DLQ, ECR e segredo |

## Arquitetura

- **Responsabilidade:** orçamentos, cobranças, conciliação com o Mercado Pago, expiração de cobrança, estornos (automáticos e pendências manuais). Clean Architecture por módulo em `src/modules/`.
- **Deploy:** EKS, namespace `billing`, com `Deployment`, `HPA` (1 a 3 réplicas), `Service` e `ServiceAccount` (IRSA) em [`k8s/`](k8s/README.md). Não há `NetworkPolicy`: o isolamento vem de namespace, IAM/IRSA e credenciais e banco próprios.
- **Banco:** database `billing` na instância RDS PostgreSQL compartilhada, com usuário próprio. Outbox em `mensagens_outbox` e consumo idempotente em `mensagens_processadas`.
- **SAGA:** consome comandos do OS na fila `billing-in` (com DLQ, criada em [`terraform/`](terraform/)) e publica os fatos na fila `os-in` do OS. Não consome eventos do Execution. A compensação financeira (cancelamento e estorno) é executada a pedido do OS.
- **REST interno:** na aprovação do orçamento, chama o OS para reservar estoque (`POST /internal/ordens-servico/:id/reservas`, com token de serviço).
- **Mercado Pago:** cobrança pela Orders API e webhook `POST /v1/webhooks/mercado-pago` validado por HMAC. A conciliação ativa cobre webhooks perdidos.
- **Borda:** o API Gateway expõe `/v1/orcamentos*`, `/v1/cobrancas*`, `/v1/pendencias-estorno*` e o webhook. As rotas usam o prefixo global `/v1` e JWT RS256 (só a chave pública é configurada aqui).
- **Observabilidade:** logs JSON com o campo `metric`, convertidos em métricas pelo Datadog (ver [`docs/metricas-de-log.md`](docs/metricas-de-log.md)).

## Execução e desenvolvimento

Pré-requisitos: Node.js 24+, Yarn 1.x e um PostgreSQL local. Variáveis de referência em [`.env.example`](.env.example). Os processadores (SQS, outbox, cobrança) são controlados por variáveis `*_HABILITADO`.

```bash
yarn install --frozen-lockfile
export DATABASE_URL="postgresql://user:pass@localhost:5432/billing?schema=public"
yarn prisma generate
yarn prisma migrate deploy
yarn start:dev
```

- Health: `GET /health` e `GET /health/ready`
- Swagger: `GET /docs`

Testes e qualidade:

```bash
yarn lint
yarn build
yarn test:cov   # unitários com cobertura
yarn test:int   # integração (PostgreSQL via DATABASE_URL)
yarn test:e2e
```

O CI (`pr-validation.yml`) roda auditoria de dependências (`audit-ci`), lint, build, cobertura, integração e e2e. Na `main`, `deploy.yml` aplica o Terraform, publica a imagem, roda a migration e faz o rollout.

A pasta [`prova-tecnica/`](prova-tecnica/README.md) tem scripts de prova do Mercado Pago, fora do `src/` e da imagem (`yarn prova-tecnica`).

## Documentação

- Arquitetura do serviço: [`docs/arquitetura.md`](docs/arquitetura.md)
- Contratos de mensagens: [`docs/contratos/mensagens-billing.md`](docs/contratos/mensagens-billing.md)
- Estorno automático: [`docs/estorno-automatico.md`](docs/estorno-automatico.md)
- Métricas de log: [`docs/metricas-de-log.md`](docs/metricas-de-log.md)
- Manifests Kubernetes: [`k8s/README.md`](k8s/README.md)
- Decisões (ADRs 008 a 015) e demais serviços: repositório `tech-challenge-oficina`
