# Arquitetura do Billing Service

Repositório autônomo (`tech-challenge-billing`) na Fase 4. Referência de padrões: ADRs 008–015 no repositório `tech-challenge`.

## Responsabilidade

Dono de orçamentos, aprovação, cobrança, estorno e pendências manuais. A E15 entrega geração por mensagem, consulta HTTP e rejeição com outbox e consumidor SQS no processo.

O estorno automático de segundo pagamento e de pagamento tardio, a retomada de estornos indeterminados e o isolamento dos lotes estão em [estorno-automatico.md](estorno-automatico.md).

## Estrutura de código

Clean Architecture por módulo em `src/modules/` (`domain/`, `application/`, `infra/` nas etapas de negócio). Código transversal em `src/shared/`.

## Runtime

NestJS 11 sobre Fastify, Node 24, PostgreSQL via Prisma 7 (`PrismaPg`), namespace Kubernetes `billing`, ServiceAccount `billing-api`, IRSA `tech-challenge-producao-billing-service`.

## Mensageria

Fila de entrada `tech-challenge-producao-billing-in` + DLQ `tech-challenge-producao-billing-in-dlq`, provisionadas no `terraform/` deste repositório.

## Implantação

Pipelines em `.github/workflows/`; deploy efetivo somente na `main` com _environment_ `producao`, conforme runbook da Fase 4.
