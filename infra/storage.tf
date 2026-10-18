# Scrape archive; holds every scraped page, so it must never be destroyed or replaced. The name has
# no env suffix and is also hardcoded in backend/src/modules/sheriffSale/scrape/saveHtmlToS3.ts.
resource "aws_s3_bucket" "archive" {
  bucket = "nj-sheriff-sale"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket = aws_s3_bucket.archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Keys are dated, but a same-day re-run overwrites a page; versioning keeps the previous copy.
# Versioning can later be suspended but never removed.
resource "aws_s3_bucket_versioning" "archive" {
  bucket = aws_s3_bucket.archive.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Bounds what versioning keeps: overwritten or deleted pages stay recoverable for 30 days.
resource "aws_s3_bucket_lifecycle_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.archive]
}
