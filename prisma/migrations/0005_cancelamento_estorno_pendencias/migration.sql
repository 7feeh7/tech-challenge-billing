-- AlterEnum
ALTER TYPE "SituacaoCobranca" ADD VALUE 'CANCELADA';
ALTER TYPE "SituacaoCobranca" ADD VALUE 'ESTORNO_EM_ANDAMENTO';
ALTER TYPE "SituacaoCobranca" ADD VALUE 'ESTORNADA';
ALTER TYPE "SituacaoCobranca" ADD VALUE 'PENDENCIA_MANUAL';

-- CreateEnum
CREATE TYPE "SituacaoOperacaoFinanceira" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDA');
CREATE TYPE "TipoOperacaoFinanceira" AS ENUM ('CANCELAMENTO_FINANCEIRO');
CREATE TYPE "ResultadoExecucaoCancelamento" AS ENUM ('REPARO_NAO_INICIADO', 'REPARO_INICIADO');
CREATE TYPE "ResultadoCancelamentoFinanceiro" AS ENUM ('NADA_A_CANCELAR', 'CANCELADA', 'ESTORNADA', 'PENDENCIA_MANUAL_ABERTA');
CREATE TYPE "SituacaoPendenciaEstorno" AS ENUM ('ABERTA', 'RESOLVIDA');
CREATE TYPE "DecisaoPendenciaEstorno" AS ENUM ('ESTORNO_INTEGRAL', 'ESTORNO_PARCIAL', 'SEM_ESTORNO');

-- CreateTable
CREATE TABLE "bloqueios_criacao_cobranca" (
    "ordem_servico_id" UUID NOT NULL,
    "rodada" INTEGER NOT NULL,
    "motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueios_criacao_cobranca_pkey" PRIMARY KEY ("ordem_servico_id","rodada")
);

-- CreateTable
CREATE TABLE "pendencias_estorno" (
    "id" UUID NOT NULL,
    "cobranca_id" UUID NOT NULL,
    "ordem_servico_id" UUID NOT NULL,
    "rodada" INTEGER NOT NULL,
    "valor_cobranca_centavos" INTEGER NOT NULL,
    "situacao" "SituacaoPendenciaEstorno" NOT NULL DEFAULT 'ABERTA',
    "motivo_abertura" TEXT NOT NULL,
    "responsavel_id" UUID,
    "decisao" "DecisaoPendenciaEstorno",
    "valor_estornado_centavos" INTEGER,
    "justificativa" TEXT,
    "resolvida_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pendencias_estorno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operacoes_financeiras" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ordem_servico_id" UUID NOT NULL,
    "rodada" INTEGER NOT NULL,
    "correlation_id" UUID NOT NULL,
    "tipo" "TipoOperacaoFinanceira" NOT NULL,
    "situacao" "SituacaoOperacaoFinanceira" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "chave_idempotencia_mercado_pago" UUID NOT NULL,
    "resultado_execucao" "ResultadoExecucaoCancelamento" NOT NULL,
    "motivo_cancelamento" TEXT,
    "etapa_origem" TEXT,
    "cobranca_id" UUID,
    "resultado" "ResultadoCancelamentoFinanceiro",
    "pendencia_id" UUID,
    "bloqueado_processamento_ate" TIMESTAMP(3),
    "tentativas_mercado_pago" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operacoes_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operacoes_financeiras_event_id_key" ON "operacoes_financeiras"("event_id");
CREATE UNIQUE INDEX "operacoes_financeiras_chave_idempotencia_mercado_pago_key" ON "operacoes_financeiras"("chave_idempotencia_mercado_pago");
CREATE INDEX "operacoes_financeiras_situacao_bloqueado_processamento_ate_idx" ON "operacoes_financeiras"("situacao", "bloqueado_processamento_ate");
CREATE INDEX "operacoes_financeiras_ordem_servico_id_rodada_idx" ON "operacoes_financeiras"("ordem_servico_id", "rodada");
CREATE INDEX "pendencias_estorno_situacao_idx" ON "pendencias_estorno"("situacao");
CREATE INDEX "pendencias_estorno_ordem_servico_id_idx" ON "pendencias_estorno"("ordem_servico_id");

-- AddForeignKey
ALTER TABLE "operacoes_financeiras" ADD CONSTRAINT "operacoes_financeiras_pendencia_id_fkey" FOREIGN KEY ("pendencia_id") REFERENCES "pendencias_estorno"("id") ON DELETE SET NULL ON UPDATE CASCADE;