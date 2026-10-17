provider "aws" {
  region              = local.region
  allowed_account_ids = [local.account_id]
}
