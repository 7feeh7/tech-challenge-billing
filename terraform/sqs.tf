resource "aws_sqs_queue" "billing_in_dlq" {
  name                      = "${local.name_prefix}-billing-in-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true

  tags = {
    Name = "${local.name_prefix}-billing-in-dlq"
  }
}

resource "aws_sqs_queue" "billing_in" {
  name                       = "${local.name_prefix}-billing-in"
  visibility_timeout_seconds = var.sqs_visibility_timeout_seconds
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 10
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.billing_in_dlq.arn
    maxReceiveCount     = var.sqs_max_receive_count
  })

  tags = {
    Name = "${local.name_prefix}-billing-in"
  }
}

resource "aws_sqs_queue_policy" "billing_in" {
  queue_url = aws_sqs_queue.billing_in.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowOsServiceSend"
        Effect    = "Allow"
        Principal = { AWS = local.os_irsa_role_arn }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.billing_in.arn
      }
    ]
  })
}