terraform {
  # >= 1.10 for S3 lockfile locking (use_lockfile) and locals in the backend block.
  required_version = ">= 1.10"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
