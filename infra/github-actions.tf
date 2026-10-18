# Lets the CI deploy-backend job assume an AWS role through GitHub's OIDC provider, so no long-lived
# AWS keys live in GitHub.

locals {
  github_repo        = "vrama21/sheriff-sale"
  github_environment = "prod"

  scraper_function_arn  = "arn:aws:lambda:${local.region}:${local.account_id}:function:${local.scraper_name}"
  scraper_role_arn      = "arn:aws:iam::${local.account_id}:role/${local.scraper_name}-role"
  scraper_dlq_arn       = "arn:aws:sqs:${local.region}:${local.account_id}:${local.scraper_name}-dlq"
  scraper_rule_arn      = "arn:aws:events:${local.region}:${local.account_id}:rule/${local.scraper_name}-rule"
  scraper_log_group_arn = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/${local.scraper_name}"
  scraper_alarms_arn    = "arn:aws:sns:${local.region}:${local.account_id}:${local.scraper_name}-alarms"
  scraper_alarm_arn     = "arn:aws:cloudwatch:${local.region}:${local.account_id}:alarm:${local.scraper_name}-*"
  github_actions_role   = "sheriff-sale-github-actions"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only jobs running in this repo's prod environment. The environment's deployment branch policy
    # decides which branches get here; the workflow's `if: main` checks are not a boundary, because
    # whoever pushes a branch controls them.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_repo}:environment:${local.github_environment}"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = local.github_actions_role
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json
}

# Everything `tofu apply` in this config touches, scoped to this project's resource ARNs. A new kind of
# resource needs a statement here first, applied locally
# (`tofu apply -target=aws_iam_role_policy.github_actions_tofu`) before CI applies the resource. The
# role can edit its own policy, so anyone who can push to main can widen it within IAM.
data "aws_iam_policy_document" "github_actions_tofu" {
  statement {
    sid       = "StateBucket"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.tofu_state.arn, "${aws_s3_bucket.tofu_state.arn}/*"]
  }

  # Bucket configuration only (encryption, public access block, versioning, lifecycle); CI never reads
  # or writes archived objects.
  statement {
    sid       = "ArchiveBucket"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.archive.arn]
  }

  statement {
    sid       = "ScraperFunction"
    actions   = ["lambda:*"]
    resources = [local.scraper_function_arn, "${local.scraper_function_arn}:*"]
  }

  statement {
    sid     = "Iam"
    actions = ["iam:*"]
    resources = [
      local.scraper_role_arn,
      "arn:aws:iam::${local.account_id}:role/${local.github_actions_role}",
      aws_iam_openid_connect_provider.github.arn,
    ]
  }

  statement {
    sid       = "ScraperQueue"
    actions   = ["sqs:*"]
    resources = [local.scraper_dlq_arn]
  }

  statement {
    sid       = "ScraperSchedule"
    actions   = ["events:*"]
    resources = [local.scraper_rule_arn]
  }

  statement {
    sid       = "ScraperLogGroup"
    actions   = ["logs:*"]
    resources = [local.scraper_log_group_arn, "${local.scraper_log_group_arn}:*"]
  }

  # The topic, and its subscriptions, whose ARNs are the topic's with a suffix.
  statement {
    sid       = "ScraperAlarmTopic"
    actions   = ["sns:*"]
    resources = [local.scraper_alarms_arn, "${local.scraper_alarms_arn}:*"]
  }

  statement {
    sid       = "ScraperAlarms"
    actions   = ["cloudwatch:*"]
    resources = [local.scraper_alarm_arn]
  }

  # DescribeLogGroups has no resource-level permissions.
  statement {
    sid       = "DescribeLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_actions_tofu" {
  name   = "tofu-apply"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_tofu.json
}
