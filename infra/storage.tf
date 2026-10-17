# Scrape archive. Imported from the old CDK stack; holds every scraped page, so it must never be
# destroyed or replaced.
resource "aws_s3_bucket" "archive" {
  bucket = "nj-sheriff-sale-${local.env}"

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
