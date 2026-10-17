# Failure alerts for the scraper. Both alarms publish to one SNS topic; subscribe to it with
# var.alarm_email (prod environment variable ALARM_EMAIL in CI), or by hand.

resource "aws_sns_topic" "scraper_alarms" {
  name = "${local.scraper_name}-alarms"
}

# The address is confirmed from the email AWS sends; until then the subscription stays pending.
resource "aws_sns_topic_subscription" "scraper_alarms_email" {
  count = var.alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.scraper_alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Stays in ALARM until the DLQ is drained, so a failed run can't be missed.
resource "aws_cloudwatch_metric_alarm" "scraper_dlq_messages" {
  alarm_name          = "${local.scraper_name}-dlq-messages"
  alarm_description   = "A scraper invocation failed and its event is waiting in ${aws_sqs_queue.scraper_dlq.name}."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.scraper_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.scraper_alarms.arn]
}

# Fires once per failed run, timeouts included.
resource "aws_cloudwatch_metric_alarm" "scraper_errors" {
  alarm_name          = "${local.scraper_name}-errors"
  alarm_description   = "The scraper Lambda ${local.scraper_name} reported an error."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.scraper.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.scraper_alarms.arn]
}
