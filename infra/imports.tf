# Cutover only: adopts resources that existed before this config. Delete this file once the
# cutover is verified; import blocks are no-ops after the first apply.

import {
  to = aws_s3_bucket.archive
  id = "nj-sheriff-sale-${local.env}"
}

import {
  to = aws_s3_bucket_server_side_encryption_configuration.archive
  id = "nj-sheriff-sale-${local.env}"
}

import {
  to = aws_cloudwatch_log_group.scraper
  id = "/aws/lambda/${local.scraper_prefix}-${local.env}"
}
