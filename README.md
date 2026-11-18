# tech-challenge-billing

Billing Service da Fase 4 — orçamentos, cobrança, estorno e pendências manuais.

## Stack

NestJS 11 (Fastify), TypeScript, Prisma 7 + PostgreSQL, Jest, Biome, Terraform (fila `billing-in`, DLQ e ECR).

## Execução local

```bash
yarn install --frozen-lockfile
export DATABASE_URL="postgresql://user:pass@localhost:5432/billing?schema=public"
yarn prisma generate
yarn prisma migrate deploy
yarn start:dev
```

- Health: `GET /health` e `GET /health/ready`
- Swagger: `GET /docs`

## Testes e cobertura

```bash
yarn lint
yarn build
yarn test:cov    # unidade + cobertura (meta ≥ 80 %)
yarn test:int    # integração PostgreSQL (DATABASE_URL)
yarn test:e2e
```

A cobertura é reportada em `coverage/lcov.info` para o SonarCloud.

## Contratos

Mensagens não financeiras em `docs/contratos/` com exemplos JSON validados nos testes.

## Observabilidade

Logs JSON estruturados com campo `metric` para as métricas de log do Datadog: ver `docs/metricas-de-log.md`.

## Infraestrutura e deploy

- Kubernetes: `k8s/` (namespace `billing`, Deployment `billing-api`, HPA **1–3** [D5.5], Job `billing-migrate`)
- Terraform: `terraform/` (fila `billing-in` + DLQ, ECR `tech-challenge-billing-producao`, contêiner `mercado-pago`, exports SSM)
- Workflows na `main` + _environment_ `producao`:
  - `deploy.yml`: testes (R4-39) → Terraform apply → imagem com tag SHA → deploy (após migration manual)
  - `migrate.yml`: Prisma migrate por `workflow_dispatch`
  - `terraform.yml`: push em `terraform/**` ou `workflow_dispatch` (`plan` padrão; `destroy` exige `DESTRUIR-tech-challenge-billing`)

Documentação dos manifests: `k8s/README.md`. Ordem operacional: runbook fase 7 (`13-deployment-runbook.md`).
