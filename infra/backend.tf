# The bucket is managed by this config (state.tf). See README.md for how it was bootstrapped.
terraform {
  backend "s3" {
    bucket       = local.state_bucket
    key          = "sheriff-sale.tfstate"
    region       = local.region
    use_lockfile = true
  }
}
