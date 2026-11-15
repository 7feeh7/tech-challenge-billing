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

## Infraestrutura

- Kubernetes: `k8s/` (namespace `billing`, Deployment `billing-api`)
- Terraform: `terraform/` (`tech-challenge-producao-billing-in`, DLQ, ECR `tech-challenge-billing-producao`)

Deploy só na branch `main` com _environment_ `producao` (ver runbook Fase 4).
