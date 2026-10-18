# Daily clerk records lookups: EventBridge schedule -> Lambda -> county clerk portals, with result pages archived to
# nj-sheriff-sale under clerk-records/. Runs as the scraper's role and shares its dead-letter queue.

resource "aws_cloudwatch_log_group" "clerk_records" {
  name              = "/aws/lambda/${local.clerk_records_name}"
  retention_in_days = aws_cloudwatch_log_group.scraper.retention_in_days
}

# Built by `npm run build` in backend/ (the second esbuild bundle).
data "archive_file" "clerk_records" {
  type             = "zip"
  source_file      = "${path.module}/../backend/dist/clerkRecords/index.js"
  output_path      = "${path.module}/.build/clerk-records.zip"
  output_file_mode = "0644" # Same hash on every machine, so CI and local plans agree.
}

resource "aws_lambda_function" "clerk_records" {
  function_name    = local.clerk_records_name
  role             = aws_iam_role.scraper.arn
  runtime          = "nodejs24.x"
  handler          = "index.handler"
  architectures    = ["x86_64"]
  memory_size      = 512
  timeout          = 900
  filename         = data.archive_file.clerk_records.output_path
  source_code_hash = data.archive_file.clerk_records.output_base64sha256

  dead_letter_config {
    target_arn = aws_sqs_queue.scraper_dlq.arn
  }

  environment {
    variables = {
      DATABASE_URL = var.database_url
    }
  }

  # Lambda checks the role can reach the DLQ at create time, and must not auto-create the log group.
  depends_on = [
    aws_cloudwatch_log_group.clerk_records,
    aws_iam_role_policy.scraper_dlq_send,
    aws_iam_role_policy.scraper_s3_archive_access,
    aws_iam_role_policy_attachment.scraper_basic_execution,
  ]
}

# A failed run goes straight to the DLQ: a retry would repeat the run's requests to the county portals.
resource "aws_lambda_function_event_invoke_config" "clerk_records" {
  function_name          = aws_lambda_function.clerk_records.function_name
  maximum_retry_attempts = 0
}

# Two hours after the scraper's 00:00 UTC run, so that day's new listings exist.
resource "aws_cloudwatch_event_rule" "clerk_records_schedule" {
  name                = "${local.clerk_records_name}-rule"
  description         = "New Jersey clerk records lookups, daily at 02:00 UTC"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "clerk_records_schedule" {
  rule = aws_cloudwatch_event_rule.clerk_records_schedule.name
  arn  = aws_lambda_function.clerk_records.arn
}

resource "aws_lambda_permission" "clerk_records_schedule" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.clerk_records.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.clerk_records_schedule.arn
}
