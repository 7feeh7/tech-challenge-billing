-- CreateEnum
CREATE TYPE "TipoEstornoAutomatico" AS ENUM ('SEGUNDO_PAGAMENTO', 'PAGAMENTO_TARDIO');

-- CreateEnum
CREATE TYPE "SituacaoEstornoAutomatico" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDO', 'PENDENCIA_MANUAL');

-- AlterTable
ALTER TABLE "orders_mercado_pago" ADD COLUMN     "confirmou_pagamento" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "estornos_automaticos" (
    "id" UUID NOT NULL,
    "cobranca_id" UUID NOT NULL,
    "order_mercado_pago_id" UUID NOT NULL,
    "tipo" "TipoEstornoAutomatico" NOT NULL,
    "situacao" "SituacaoEstornoAutomatico" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "chave_idempotencia" UUID NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "aprovado_em" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_processamento_ate" TIMESTAMP(3),
    "pendencia_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estornos_automaticos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estornos_automaticos_order_mercado_pago_id_key" ON "estornos_automaticos"("order_mercado_pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "estornos_automaticos_chave_idempotencia_key" ON "estornos_automaticos"("chave_idempotencia");

-- CreateIndex
CREATE INDEX "estornos_automaticos_situacao_bloqueado_processamento_ate_idx" ON "estornos_automaticos"("situacao", "bloqueado_processamento_ate");

-- CreateIndex
CREATE INDEX "estornos_automaticos_pendencia_id_idx" ON "estornos_automaticos"("pendencia_id");

-- AddForeignKey
ALTER TABLE "estornos_automaticos" ADD CONSTRAINT "estornos_automaticos_cobranca_id_fkey" FOREIGN KEY ("cobranca_id") REFERENCES "cobrancas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estornos_automaticos" ADD CONSTRAINT "estornos_automaticos_order_mercado_pago_id_fkey" FOREIGN KEY ("order_mercado_pago_id") REFERENCES "orders_mercado_pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estornos_automaticos" ADD CONSTRAINT "estornos_automaticos_pendencia_id_fkey" FOREIGN KEY ("pendencia_id") REFERENCES "pendencias_estorno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
