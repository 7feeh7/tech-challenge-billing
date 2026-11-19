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

## Auditoria de dependências no CI

O `pr-validation.yml` roda duas auditorias com `audit-ci@7.1.0`, ambas falhando só em vulnerabilidade alta ou crítica (o código de saída do `yarn audit` ignora o nível):

- **Produção, sem exceção:** `npx audit-ci@7.1.0 --high --skip-dev`, sem arquivo de configuração nem allowlist.
- **Completa (com devDependencies):** `npx audit-ci@7.1.0 --config audit-ci.jsonc`.

Exceção temporária em `audit-ci.jsonc`: `GHSA-fc5q-39xc-vjpf` (picomatch <=4.0.7, ReDoS em extglobs repetidos).

- **Justificativa:** não há versão corrigida publicada e o pacote só aparece em cadeias de desenvolvimento (`@nestjs/cli`, `@nestjs/schematics`, `jest`, `ts-loader`). Ele não vai para a imagem de produção: o `Dockerfile` instala só dependências de produção (`yarn install --production`; `prisma` e `dotenv` ficam em `dependencies` porque o job de migration roda na mesma imagem), e a auditoria de produção passa sem a exceção.
- **Situação em 2026-11-18:** o `yarn audit` deixou de listar esse advisory como alto ou crítico, e o audit-ci avisa "Consider not allowlisting". A entrada fica como exceção preventiva, porque a classificação mudou durante o mesmo dia, e sai na reavaliação se continuar sem uso.
- **Prazo:** 2026-12-18 (campo `expiry`; depois dessa data a entrada deixa de valer e o advisory volta a falhar o CI se for classificado como alto ou crítico). Reavaliação obrigatória no checkpoint anterior à implantação. Decisão do autor em 2026-11-18.
- **Condição de remoção:** remover a entrada quando houver `picomatch` corrigido alcançável pelas dependências, ou no checkpoint se a imagem de produção passar a contê-lo.

O SonarCloud está temporariamente desabilitado no `pr-validation.yml` (decisão de 2026-11-18); reativar no checkpoint 2.3 do runbook de implantação.

## Contratos

Mensagens não financeiras em `docs/contratos/` com exemplos JSON validados nos testes.

## Observabilidade

Logs JSON estruturados com campo `metric` para as métricas de log do Datadog: ver `docs/metricas-de-log.md`.

## Infraestrutura e deploy

- Kubernetes: `k8s/` (namespace `billing`, Deployment `billing-api`, HPA **1–3** [D5.5], Service NodePort `30081`, Job de migration `billing-migrate-<id>`)
- Terraform: `terraform/` (fila `billing-in` + DLQ, ECR `tech-challenge-billing-producao`, contêiner `mercado-pago`, exports SSM)
- Workflows na `main` + _environment_ `producao`:
  - `deploy.yml`: uma run, cada job por `needs`: testes (R4-39) → Terraform apply → imagem com tag SHA → migration (Job com a mesma imagem) → rollout com a mesma tag
  - `migrate.yml`: só manutenção manual (`workflow_dispatch`, input `image_tag`); fora do fluxo normal de implantação
  - `terraform.yml`: push em `terraform/**` ou `workflow_dispatch` (`plan` padrão; `destroy` exige `DESTRUIR-tech-challenge-billing`)

Documentação dos manifests: `k8s/README.md`. Ordem operacional: runbook fase 7 (`13-deployment-runbook.md`).
