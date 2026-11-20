resource "aws_secretsmanager_secret" "mercado_pago" {
  name        = "${local.name_prefix}/mercado-pago"
  description = "Credenciais Mercado Pago do Billing (access token e segredo do webhook). Valor gravado manualmente no runbook 7.2."

  recovery_window_in_days = 7
}

output "mercado_pago_secret_arn" {
  description = "ARN do contêiner do segredo Mercado Pago (sem valor na criação)"
  value       = aws_secretsmanager_secret.mercado_pago.arn
}