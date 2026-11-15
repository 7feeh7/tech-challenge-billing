output "billing_in_queue_url" {
  description = "URL da fila de entrada do Billing"
  value       = aws_sqs_queue.billing_in.url
}

output "billing_in_queue_arn" {
  description = "ARN da fila de entrada do Billing"
  value       = aws_sqs_queue.billing_in.arn
}

output "billing_in_dlq_url" {
  description = "URL da DLQ do Billing"
  value       = aws_sqs_queue.billing_in_dlq.url
}

output "billing_in_dlq_arn" {
  description = "ARN da DLQ do Billing"
  value       = aws_sqs_queue.billing_in_dlq.arn
}

output "ecr_repository_url" {
  description = "URL do repositório ECR do Billing"
  value       = aws_ecr_repository.billing.repository_url
}