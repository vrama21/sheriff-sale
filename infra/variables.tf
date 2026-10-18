variable "database_url" {
  description = "Postgres connection string passed to the scraper Lambda as DATABASE_URL."
  type        = string
  sensitive   = true
}
