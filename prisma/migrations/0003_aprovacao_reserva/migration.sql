-- CreateEnum
CREATE TYPE "SituacaoCobranca" AS ENUM ('INTENCAO');

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN "prazo_referencia" TIMESTAMP(3),
ADD COLUMN "reserva_id" UUID,
ADD COLUMN "aprovado_em" TIMESTAMP(3),
ADD COLUMN "bloqueado_aprovacao_ate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orcamentos_situacao_bloqueado_aprovacao_ate_idx" ON "orcamentos"("situacao", "bloqueado_aprovacao_ate");

-- CreateTable
CREATE TABLE "cobrancas" (
    "id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "ordem_servico_id" UUID NOT NULL,
    "rodada" INTEGER NOT NULL,
    "cliente_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "valor_total_centavos" INTEGER NOT NULL,
    "prazo_pagamento" TIMESTAMP(3) NOT NULL,
    "situacao" "SituacaoCobranca" NOT NULL DEFAULT 'INTENCAO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobrancas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_orcamento_id_key" ON "cobrancas"("orcamento_id");

-- AddForeignKey
ALTER TABLE "cobrancas" ADD CONSTRAINT "cobrancas_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;