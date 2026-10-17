locals {
  account_id = "590184139982"
  region     = "us-east-2"

  # AWS hosts a single environment, so resource names carry no env; this is only the ENV value the
  # scraper Lambda runs with.
  env = "prod"

  # Referenced by the backend block, so it must stay a static value.
  state_bucket = "sheriff-sale-tofu-state-${local.account_id}"

  scraper_name = "new-jersey-sheriff-sale-scraper"
}
