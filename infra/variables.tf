variable "database_url" {
  description = "Postgres connection string passed to the scraper Lambda as DATABASE_URL."
  type        = string
  sensitive   = true
}

variable "alarm_email" {
  description = "Email address subscribed to the scraper alarm topic. Empty (the default) creates no subscription. CI passes the prod environment variable ALARM_EMAIL."
  type        = string
  default     = ""
}
