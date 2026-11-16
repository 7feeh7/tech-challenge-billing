-- AlterEnum
ALTER TYPE "SituacaoCobranca" ADD VALUE 'EXPIRADA';

-- CreateEnum
CREATE TYPE "FinalidadeConsultaSituacaoFinanceira" AS ENUM ('PRAZO_DE_REFERENCIA_VENCIDO', 'EXCECAO_E10');
CREATE TYPE "ResultadoConsultaSituacaoFinanceira" AS ENUM ('PAGO_NO_PRAZO', 'SEM_PAGAMENTO', 'INDETERMINADA');
CREATE TYPE "SituacaoEstornoConsulta" AS ENUM ('NENHUM', 'EM_ANDAMENTO', 'REALIZADO', 'INDETERMINADO');
CREATE TYPE "TipoPendenciaFinanceiraMonitoramento" AS ENUM ('SITUACAO_FINANCEIRA_INDETERMINADA');

-- AlterEnum
ALTER TYPE "TipoOperacaoFinanceira" ADD VALUE 'CONSULTA_SITUACAO_FINANCEIRA';

-- AlterTable
ALTER TABLE "operacoes_financeiras" ALTER COLUMN "resultado_execucao" DROP NOT NULL;
ALTER TABLE "operacoes_financeiras" ADD COLUMN "consulta_id" UUID,
ADD COLUMN "finalidade_consulta" "FinalidadeConsultaSituacaoFinanceira",
ADD COLUMN "resultado_consulta" "ResultadoConsultaSituacaoFinanceira";

-- CreateIndex
CREATE UNIQUE INDEX "operacoes_financeiras_consulta_id_key" ON "operacoes_financeiras"("consulta_id");

-- CreateTable
CREATE TABLE "pendencias_financeira_monitoramento" (
    "id" UUID NOT NULL,
    "tipo" "TipoPendenciaFinanceiraMonitoramento" NOT NULL,
    "operacao_id" UUID,
    "cobranca_id" UUID,
    "ordem_servico_id" UUID NOT NULL,
    "rodada" INTEGER NOT NULL,
    "correlation_id" UUID NOT NULL,
    "motivo" TEXT,
    "resolvido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pendencias_financeira_monitoramento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pendencias_financeira_monitoramento_tipo_resolvido_em_idx" ON "pendencias_financeira_monitoramento"("tipo", "resolvido_em");