# Kubernetes — Billing (`billing`)

Manifests do `billing-api` no namespace `billing` (D6.4: sem `NetworkPolicy` nesta fase).

## Recursos

| Recurso        | Nome                   | Observação                                                                   |
| -------------- | ---------------------- | ---------------------------------------------------------------------------- |
| ServiceAccount | `billing-api`          | IRSA `tech-challenge-producao-billing-service`                               |
| ConfigMap      | `billing-config`       | Variáveis não secretas e processadores de produção (E20)                     |
| Secret         | `billing-secret`       | Criado pelo pipeline a partir do Secrets Manager (nunca versionado)          |
| Deployment     | `billing-api`          | RollingUpdate `maxSurge: 1`, readiness `/health/ready`                       |
| Service        | `billing-api`          | NodePort `30081` (porta 80 → `http` :3000), ver "Exposição"                  |
| HPA            | `billing-api`          | **1–3 réplicas (D5.5)** — o OS permanece 1–6                                 |
| Job            | `billing-migrate-<id>` | Prisma migrate com Secret próprio; roda no `deploy.yml` **antes** do rollout |

## Pool de conexões (D5.5 + E09)

Decisão **D5.5**: Billing **máx. 3** réplicas, pool **5** por pod. Usuário RDS `billing`: `CONNECTION LIMIT 22` (E09). Não confundir com o OS (máx. 6 réplicas, limite 37).

| Cenário                                        | Pods com pool ativo | Conexões máx. do usuário `billing` | Dentro do 22?                                                                 |
| ---------------------------------------------- | ------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| HPA no teto (3 réplicas)                       | 3 × 5               | 15                                 | Sim                                                                           |
| Rolling update no teto (`maxSurge: 1`)         | 4 × 5               | 20                                 | Sim                                                                           |
| Migrate Job + 3 réplicas (evitar sobreposição) | 3 × 5 + 1 × 5 (Job) | 20                                 | Sim, se o Job não coincidir com surge de 4 pods                               |
| Pior caso teórico (3 + surge + Job)            | 5 × 5               | 25                                 | Não — o Job é removido antes do rollout (job `deploy` depende de `migration`) |

O job `migration` só termina depois de remover o Job (`--cascade=foreground --wait=true`), e o job `deploy` depende dele: o Job nunca coexiste com o _surge_. Migration com falha não autoriza rollout (Job `Failed` ou 600 s sem `Complete` falham a run; o Deployment anterior segue no ar).

## Migration (Job)

O `migration-job.yaml` usa a mesma imagem imutável do Deployment (tag = SHA do commit) e só o que o `prisma migrate deploy` lê (`DATABASE_URL`, em `prisma.config.ts`):

- Secret próprio `billing-migrate-secret-<id>`, só com `DATABASE_URL`; nunca o `billing-secret` da aplicação (Mercado Pago, tokens, chave JWT).
- Sem ConfigMap e sem a ServiceAccount `billing-api` (IRSA): roda com a ServiceAccount padrão do namespace.
- Job e Secret têm nome único por run (`<id>` = `<run_id>-<tentativa>`), e a limpeza (`if: always()`) remove só os da própria run.
- A espera tolera falhas transitórias da API do cluster (até 5 consultas seguidas com erro) dentro do prazo total de 600 s; `Failed` ou prazo esgotado falham o passo.
- Lógica em `.github/actions/migration-billing/action.yml`, usada pelo `deploy.yml` e pelo `migrate.yml`; as leituras da AWS ficam em `.github/scripts/parametros-aws.sh`, sem valor secreto em `${{ }}` dentro de comando nem em _output_ de passo.

## Exposição (NodePort 30081)

O `Service` `billing-api` é `NodePort` com `nodePort: 30081`, `port: 80` e `targetPort: http`; o `ClusterIP` continua atendendo as chamadas internas (`http://billing-api`). Correspondência com o `tech-challenge-infra-kubernetes` (`docs/rotas-e-rede.md`, `terraform/rotas.tf`):

| Peça                         | Valor                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Listener do NLB interno      | `8081` (TCP)                                                                                        |
| Target group                 | `tech-challenge-producao-bill-tg` (tipo `instance`)                                                 |
| NodePort no node             | `30081` (este `Service`)                                                                            |
| Porta do contêiner           | `http` = `containerPort: 3000` (`deployment.yaml`)                                                  |
| Health check do target group | HTTP `GET /health` na raiz, respondido pelo Billing (`src/main.ts` exclui `health` do prefixo `v1`) |

Nenhuma outra porta é exposta: não há `LoadBalancer` nem outro `nodePort`. O tráfego público entra só pelo API Gateway.

## Ordem no pipeline (runbook 7)

1. Push na `main` (código da app, fora de `terraform/**`) ou `workflow_dispatch` do `deploy.yml`: uma run, cada job por `needs`, só na `main`:
   `test` → `terraform` (apply do serviço) → `build` (imagem com tag `${{ github.sha }}`) → `migration` (Job com a mesma imagem até `Complete`, removido ao fim) → `deploy` (rollout com a mesma tag e smoke test).
2. Aprovações: `terraform`, `build`, `migration` e `deploy` usam o _environment_ `producao` (OIDC), e cada um pede a aprovação configurada nele (quatro aprovações por run).
3. Falha da migration (Job `Failed`, 600 s sem `Complete` ou 5 consultas seguidas com erro) falha a run e o `deploy` não roda; o Deployment anterior segue no ar.
4. Push na `main` só em `terraform/**`: `Terraform Billing` (state compartilhado).
5. Manutenção manual na `main`, `producao`: `Database Migration` (`migrate.yml`) com `image_tag` de uma imagem já publicada; fora do fluxo normal.

Os três workflows usam o grupo `billing-producao-pipeline` (`cancel-in-progress: false`): o `migrate.yml` e o `terraform.yml` esperam o `deploy.yml` terminar, o que serializa o state do Terraform e o orçamento de conexões. A migration do fluxo normal roda dentro do `deploy.yml`, então a fila do grupo não bloqueia a implantação, e o `deploy.yml` não espera outro workflow (sem `workflow_run`).

**Runs pendentes:** o GitHub mantém uma run em execução e **uma** pendente por grupo. Uma nova run cancela a pendente, mesmo com `cancel-in-progress: false`, inclusive entre workflows diferentes (um push na `main` cancela um `migrate.yml` pendente; disparar o `migrate.yml` cancela um `deploy.yml` pendente). Antes de disparar qualquer workflow do Billing, confira em Actions se há run em execução ou pendente; se um commit teve a run pendente cancelada, a run seguinte constrói e implanta o estado mais recente da `main`.
