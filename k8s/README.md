# Kubernetes — Billing (`billing`)

Manifests do `billing-api` no namespace `billing` (D6.4: sem `NetworkPolicy` nesta fase).

## Recursos

| Recurso        | Nome              | Observação                                                          |
| -------------- | ----------------- | ------------------------------------------------------------------- |
| ServiceAccount | `billing-api`     | IRSA `tech-challenge-producao-billing-service`                      |
| ConfigMap      | `billing-config`  | Variáveis não secretas e processadores de produção (E20)            |
| Secret         | `billing-secret`  | Criado pelo pipeline a partir do Secrets Manager (nunca versionado) |
| Deployment     | `billing-api`     | RollingUpdate `maxSurge: 1`, readiness `/health/ready`              |
| Service        | `billing-api`     | ClusterIP :3000 (sem exposição pública; API Gateway no NLB)         |
| HPA            | `billing-api`     | **1–3 réplicas (D5.5)** — o OS permanece 1–6                        |
| Job            | `billing-migrate` | Prisma migrate; workflow `migrate.yml` **antes** do rollout         |

## Pool de conexões (D5.5 + E09)

Decisão **D5.5**: Billing **máx. 3** réplicas, pool **5** por pod. Usuário RDS `billing`: `CONNECTION LIMIT 22` (E09). Não confundir com o OS (máx. 6 réplicas, limite 37).

| Cenário | Pods com pool ativo | Conexões máx. do usuário `billing` | Dentro do 22? |
| --- | --- | --- | --- |
| HPA no teto (3 réplicas) | 3 × 5 | 15 | Sim |
| Rolling update no teto (`maxSurge: 1`) | 4 × 5 | 20 | Sim |
| Migrate Job + 3 réplicas (evitar sobreposição) | 3 × 5 + 1 × 5 (Job) | 20 | Sim, se o Job não coincidir com surge de 4 pods |
| Pior caso teórico (3 + surge + Job) | 5 × 5 | 25 | Não — **não aprovar deploy enquanto `billing-migrate` estiver ativo** |

Runbook: concluir e remover o Job de migration antes de aprovar o job `Deploy no EKS`. Migration com falha não autoriza rollout (Job `Failed`; Deployment anterior segue).

## Ordem no pipeline (runbook 7)

1. Push na `main` (código da app, fora de `terraform/**`): `test` → `terraform` (apply) → build/push SHA → **aguardar aprovação** em `producao` no deploy.
2. Push na `main` (só `terraform/**`): `Terraform Billing` (state compartilhado; concurrency `billing-producao-pipeline` com deploy e migrate — `cancel-in-progress: false`).
3. Manual na `main`, `producao`: `Database Migration` com tag SHA da imagem a implantar.
4. Manual na `main`, `producao`: aprovar `Deploy no EKS` somente após migrate `Complete`.

Nenhuma migration no deploy automático (D9.1).