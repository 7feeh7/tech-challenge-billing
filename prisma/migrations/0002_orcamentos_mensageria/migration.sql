-- CreateEnum
CREATE TYPE "SituacaoOrcamento" AS ENUM ('GERADO', 'APROVACAO_EM_ANDAMENTO', 'APROVADO', 'REJEITADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoItemOrcamento" AS ENUM ('SERVICO', 'PECA');

-- CreateTable
CREATE TABLE "orcamentos" (
    "id" UUID NOT NULL,
    "ordem_servico_id" UUID NOT NULL,
    "rodada" INTEGER NOT NULL,
    "cliente_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "valor_total_centavos" INTEGER NOT NULL,
    "situacao" "SituacaoOrcamento" NOT NULL DEFAULT 'GERADO',
    "motivo_rejeicao" TEXT,
    "tentativa_aprovacao" INTEGER NOT NULL DEFAULT 0,
    "rejeitado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orcamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_itens" (
    "id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "tipo" "TipoItemOrcamento" NOT NULL,
    "item_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario_centavos" INTEGER NOT NULL,

    CONSTRAINT "orcamento_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_outbox" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "correlation_id" UUID NOT NULL,
    "destino" TEXT NOT NULL,
    "bloqueado_ate" TIMESTAMP(3),
    "enviado_em" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_processadas" (
    "event_id" UUID NOT NULL,
    "hash_conteudo" TEXT NOT NULL,
    "processado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_processadas_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orcamentos_ordem_servico_id_rodada_key" ON "orcamentos"("ordem_servico_id", "rodada");

-- CreateIndex
CREATE UNIQUE INDEX "mensagens_outbox_event_id_key" ON "mensagens_outbox"("event_id");

-- CreateIndex
CREATE INDEX "mensagens_outbox_enviado_em_bloqueado_ate_idx" ON "mensagens_outbox"("enviado_em", "bloqueado_ate");

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;