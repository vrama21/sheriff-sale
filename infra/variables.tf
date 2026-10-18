variable "database_url" {
  description = "Postgres connection string passed to the scraper Lambda as DATABASE_URL."
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Email address the scraper alarms notify through SNS. CI sets it from the ALERT_EMAIL repository variable."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be an email address; set the ALERT_EMAIL repository variable."
  }
}
