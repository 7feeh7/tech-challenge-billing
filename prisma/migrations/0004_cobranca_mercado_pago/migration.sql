-- CreateEnum
CREATE TYPE "SituacaoOperacaoCriacaoOrder" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDA');

-- AlterEnum
ALTER TYPE "SituacaoCobranca" ADD VALUE 'PENDENTE';
ALTER TYPE "SituacaoCobranca" ADD VALUE 'PAGA';

-- AlterTable
ALTER TABLE "cobrancas" ADD COLUMN "link_pagamento" TEXT,
ADD COLUMN "pagamento_confirmado_em" TIMESTAMP(3),
ADD COLUMN "bloqueado_conciliacao_ate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "cobrancas_situacao_bloqueado_conciliacao_ate_idx" ON "cobrancas"("situacao", "bloqueado_conciliacao_ate");
CREATE INDEX "cobrancas_ordem_servico_id_idx" ON "cobrancas"("ordem_servico_id");

-- CreateTable
CREATE TABLE "orders_mercado_pago" (
    "id" UUID NOT NULL,
    "cobranca_id" UUID NOT NULL,
    "mercado_pago_order_id" TEXT NOT NULL,
    "chave_idempotencia" UUID NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "status_order" TEXT,
    "status_detail" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_mercado_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operacoes_criacao_order" (
    "id" UUID NOT NULL,
    "cobranca_id" UUID NOT NULL,
    "chave_idempotencia" UUID NOT NULL,
    "situacao" "SituacaoOperacaoCriacaoOrder" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operacoes_criacao_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos_webhook_mercado_pago" (
    "id" UUID NOT NULL,
    "cobranca_id" UUID,
    "mercado_pago_order_id" TEXT NOT NULL,
    "request_id" TEXT,
    "notificacao_id" TEXT,
    "tipo" TEXT,
    "acao" TEXT,
    "recebida_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_webhook_mercado_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tentativas_pagamento_recusadas" (
    "id" UUID NOT NULL,
    "cobranca_id" UUID NOT NULL,
    "order_mercado_pago_id" UUID NOT NULL,
    "payment_id_mercado_pago" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "registrada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_pagamento_recusadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_mercado_pago_mercado_pago_order_id_key" ON "orders_mercado_pago"("mercado_pago_order_id");
CREATE UNIQUE INDEX "orders_mercado_pago_chave_idempotencia_key" ON "orders_mercado_pago"("chave_idempotencia");
CREATE INDEX "orders_mercado_pago_cobranca_id_ativa_idx" ON "orders_mercado_pago"("cobranca_id", "ativa");
CREATE UNIQUE INDEX "operacoes_criacao_order_cobranca_id_key" ON "operacoes_criacao_order"("cobranca_id");
CREATE UNIQUE INDEX "operacoes_criacao_order_chave_idempotencia_key" ON "operacoes_criacao_order"("chave_idempotencia");
CREATE INDEX "avisos_webhook_mercado_pago_mercado_pago_order_id_idx" ON "avisos_webhook_mercado_pago"("mercado_pago_order_id");
CREATE UNIQUE INDEX "tentativas_pagamento_recusadas_cobranca_id_payment_id_merc_key" ON "tentativas_pagamento_recusadas"("cobranca_id", "payment_id_mercado_pago");

-- AddForeignKey
ALTER TABLE "orders_mercado_pago" ADD CONSTRAINT "orders_mercado_pago_cobranca_id_fkey" FOREIGN KEY ("cobranca_id") REFERENCES "cobrancas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operacoes_criacao_order" ADD CONSTRAINT "operacoes_criacao_order_cobranca_id_fkey" FOREIGN KEY ("cobranca_id") REFERENCES "cobrancas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "avisos_webhook_mercado_pago" ADD CONSTRAINT "avisos_webhook_mercado_pago_cobranca_id_fkey" FOREIGN KEY ("cobranca_id") REFERENCES "cobrancas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tentativas_pagamento_recusadas" ADD CONSTRAINT "tentativas_pagamento_recusadas_cobranca_id_fkey" FOREIGN KEY ("cobranca_id") REFERENCES "cobrancas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tentativas_pagamento_recusadas" ADD CONSTRAINT "tentativas_pagamento_recusadas_order_mercado_pago_id_fkey" FOREIGN KEY ("order_mercado_pago_id") REFERENCES "orders_mercado_pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;