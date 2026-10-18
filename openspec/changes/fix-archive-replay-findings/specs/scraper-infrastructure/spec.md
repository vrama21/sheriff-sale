## ADDED Requirements

### Requirement: Scraper alarms

OpenTofu SHALL manage an SNS topic named `new-jersey-sheriff-sale-scraper-alarms` with an email subscription to the address in an `alert_email` input variable. It SHALL manage three CloudWatch alarms that notify that topic when they enter `ALARM`:

- `new-jersey-sheriff-sale-scraper-errors`: the function's `Errors` metric is at least 1 in a 1-day period.
- `new-jersey-sheriff-sale-scraper-dlq`: the dead-letter queue's `ApproximateNumberOfMessagesVisible` is at least 1.
- `new-jersey-sheriff-sale-scraper-no-runs`: the function's `Invocations` metric is below 1 in a 1-day period, with missing data treated as breaching.

#### Scenario: Failed scheduled run alerts

- **WHEN** a scheduled invocation throws because a county failed
- **THEN** the errors alarm enters `ALARM` and the topic's subscriber receives an email

#### Scenario: Schedule stops

- **WHEN** the function isn't invoked for a full day
- **THEN** the no-runs alarm enters `ALARM` and the subscriber receives an email

#### Scenario: Healthy day

- **WHEN** the scheduled run succeeds for every county
- **THEN** all three alarms stay `OK`
