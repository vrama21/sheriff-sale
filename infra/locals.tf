locals {
  account_id = "590184139982"
  region     = "us-east-2"

  # Referenced by the backend block, so it must stay a static value.
  state_bucket = "sheriff-sale-tofu-state-${local.account_id}"

  scraper_name = "new-jersey-sheriff-sale-scraper"
}
