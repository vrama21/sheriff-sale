# Daily New Jersey sheriff sale scraper: EventBridge schedule -> Lambda -> S3 archive, with an SQS
# dead-letter queue for failed async invocations.

resource "aws_cloudwatch_log_group" "scraper" {
  name              = "/aws/lambda/${local.scraper_name}"
  retention_in_days = 90
}

resource "aws_sqs_queue" "scraper_dlq" {
  name                      = "${local.scraper_name}-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
}

data "aws_iam_policy_document" "scraper_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scraper" {
  name               = "${local.scraper_name}-role"
  assume_role_policy = data.aws_iam_policy_document.scraper_assume_role.json
}

resource "aws_iam_role_policy_attachment" "scraper_basic_execution" {
  role       = aws_iam_role.scraper.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "scraper_s3_archive_access" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.archive.arn}/*"]
  }
}

resource "aws_iam_role_policy" "scraper_s3_archive_access" {
  name   = "s3-archive-access"
  role   = aws_iam_role.scraper.id
  policy = data.aws_iam_policy_document.scraper_s3_archive_access.json
}

data "aws_iam_policy_document" "scraper_dlq_send" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.scraper_dlq.arn]
  }
}

resource "aws_iam_role_policy" "scraper_dlq_send" {
  name   = "dlq-send"
  role   = aws_iam_role.scraper.id
  policy = data.aws_iam_policy_document.scraper_dlq_send.json
}

# Built by `npm run build` in backend/ (esbuild bundle).
data "archive_file" "scraper" {
  type             = "zip"
  source_file      = "${path.module}/../backend/dist/index.js"
  output_path      = "${path.module}/.build/scraper.zip"
  output_file_mode = "0644" # Same hash on every machine, so CI and local plans agree.
}

resource "aws_lambda_function" "scraper" {
  function_name    = local.scraper_name
  role             = aws_iam_role.scraper.arn
  runtime          = "nodejs24.x"
  handler          = "index.handler"
  architectures    = ["x86_64"]
  memory_size      = 512
  timeout          = 900
  filename         = data.archive_file.scraper.output_path
  source_code_hash = data.archive_file.scraper.output_base64sha256

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
    aws_cloudwatch_log_group.scraper,
    aws_iam_role_policy.scraper_dlq_send,
    aws_iam_role_policy.scraper_s3_archive_access,
    aws_iam_role_policy_attachment.scraper_basic_execution,
  ]
}

# A failed run goes straight to the DLQ instead of the default 2 retries, each another
# 15-minute scrape against the county sites. Re-running is a deliberate manual invoke.
resource "aws_lambda_function_event_invoke_config" "scraper" {
  function_name          = aws_lambda_function.scraper.function_name
  maximum_retry_attempts = 0
}

resource "aws_cloudwatch_event_rule" "scraper_schedule" {
  name                = "${local.scraper_name}-rule"
  description         = "New Jersey Sheriff Sale Scraper cron rule to run at 12:00AM UTC every day"
  schedule_expression = "cron(0 0 * * ? *)"
}

resource "aws_cloudwatch_event_target" "scraper_schedule" {
  rule = aws_cloudwatch_event_rule.scraper_schedule.name
  arn  = aws_lambda_function.scraper.arn
}

resource "aws_lambda_permission" "scraper_schedule" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scraper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scraper_schedule.arn
}
