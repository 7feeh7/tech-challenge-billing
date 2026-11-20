locals {
  ssm_prefix = "/tech-challenge/${var.environment}"
}

resource "aws_ssm_parameter" "billing_ecr_repository_url" {
  name  = "${local.ssm_prefix}/infra/billing_ecr_repository_url"
  type  = "String"
  value = aws_ecr_repository.billing.repository_url
}

resource "aws_ssm_parameter" "billing_in_queue_url" {
  name  = "${local.ssm_prefix}/infra/billing_in_queue_url"
  type  = "String"
  value = aws_sqs_queue.billing_in.url
}

resource "aws_ssm_parameter" "billing_in_queue_arn" {
  name  = "${local.ssm_prefix}/infra/billing_in_queue_arn"
  type  = "String"
  value = aws_sqs_queue.billing_in.arn
}

resource "aws_ssm_parameter" "mercado_pago_secret_arn" {
  name  = "${local.ssm_prefix}/infra/mercado_pago_secret_arn"
  type  = "String"
  value = aws_secretsmanager_secret.mercado_pago.arn
}