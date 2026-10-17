## MODIFIED Requirements

### Requirement: Archive bucket

OpenTofu SHALL manage an S3 bucket named `nj-sheriff-sale`. The name SHALL NOT be derived from the environment. The resource SHALL set `lifecycle { prevent_destroy = true }` and SHALL declare:

- AES256 default server-side encryption
- all four S3 Block Public Access settings
- versioning, enabled
- a lifecycle rule that expires noncurrent versions after 30 days and aborts incomplete multipart uploads after 7 days

#### Scenario: Accidental destroy

- **WHEN** a plan would destroy or replace `nj-sheriff-sale`
- **THEN** OpenTofu refuses the plan with a `prevent_destroy` error

#### Scenario: Steady state

- **WHEN** `tofu plan` runs after apply
- **THEN** the plan shows no changes to `nj-sheriff-sale` or its encryption, public access block, versioning, or lifecycle configuration

#### Scenario: Overwritten page is recoverable

- **WHEN** an archived object is overwritten or deleted
- **THEN** its previous version stays retrievable for 30 days

### Requirement: Scraper writes to the fixed archive bucket

The scraper SHALL write scraped HTML to `nj-sheriff-sale`, a name fixed in code and not read from the environment.

#### Scenario: Save from the deployed Lambda

- **WHEN** the deployed scraper saves a page
- **THEN** the object is written to `nj-sheriff-sale` under `<keyPrefix>/<YYYY-MM-DD>/<keySuffix>`

### Requirement: Scraper Lambda function

OpenTofu SHALL manage a Lambda function named `new-jersey-sheriff-sale-scraper`. It SHALL use runtime `nodejs24.x`, handler `index.handler`, 512 MB memory, a 900-second timeout, and the x86_64 architecture. Its code SHALL be the esbuild bundle of `backend/src/modules/sheriffSale/handler.ts`. Its environment SHALL contain exactly `DATABASE_URL`, which SHALL come from a `sensitive` input variable.

#### Scenario: Function configuration after apply

- **WHEN** `aws lambda get-function-configuration` is run against `new-jersey-sheriff-sale-scraper` after apply
- **THEN** it reports runtime `nodejs24.x`, handler `index.handler`, memory 512, timeout 900, and environment key `DATABASE_URL` only

#### Scenario: Manual invocation

- **WHEN** the function is invoked manually after cutover
- **THEN** it returns successfully and writes scraped HTML objects under today's date to `nj-sheriff-sale`

#### Scenario: Code change

- **WHEN** the handler source changes and the bundle is rebuilt
- **THEN** `tofu plan` shows an in-place update of the function code driven by the bundle hash

### Requirement: Scraper log group

OpenTofu SHALL create and manage the log group `/aws/lambda/new-jersey-sheriff-sale-scraper` before the function, so that Lambda does not create it outside OpenTofu. The log group SHALL retain events for 90 days. The old log group `/aws/lambda/new-jersey-sheriff-sale-scraper-dev` SHALL be kept, outside OpenTofu, so the pre-migration history stays searchable in CloudWatch alongside the new group.

#### Scenario: Log group owned by OpenTofu

- **WHEN** the function is first invoked after apply
- **THEN** its logs go to the OpenTofu-managed `/aws/lambda/new-jersey-sheriff-sale-scraper`, and `tofu plan` shows no changes

#### Scenario: Retention

- **WHEN** the log group's attributes are read after apply
- **THEN** `retentionInDays` is 90

### Requirement: Single environment with env-less names

AWS SHALL host exactly one deployed environment. No resource name SHALL contain an environment name such as `prod` or `dev`, and no resource SHALL carry an environment-name variable.

#### Scenario: Names after cutover

- **WHEN** the scraper resources are listed after cutover
- **THEN** the function, role, queue, rule, and log group are named `new-jersey-sheriff-sale-scraper`, `…-role`, `…-dlq`, `…-rule`, and `/aws/lambda/new-jersey-sheriff-sale-scraper`, and no OpenTofu-managed resource name ends in `-prod` or `-dev`

## ADDED Requirements

### Requirement: No automatic async retries

OpenTofu SHALL manage an event invoke config for the scraper function with `maximum_retry_attempts = 0`. A failed scheduled run SHALL go straight to the dead-letter queue, and SHALL NOT re-run against the county sites.

#### Scenario: Failed scheduled run

- **WHEN** a scheduled invocation throws or times out
- **THEN** the function is not invoked again for that event, and the event appears in `new-jersey-sheriff-sale-scraper-dlq`

### Requirement: Scraper failure alarms

OpenTofu SHALL manage an SNS topic named `new-jersey-sheriff-sale-scraper-alarms`, and these two CloudWatch alarms, whose alarm action is that topic:

- `new-jersey-sheriff-sale-scraper-dlq-messages`: `ApproximateNumberOfMessagesVisible` on the dead-letter queue, Maximum greater than 0
- `new-jersey-sheriff-sale-scraper-errors`: `Errors` on the scraper function, Sum greater than 0

Both SHALL treat missing data as not breaching. The topic SHALL get an email subscription only when the `alarm_email` input variable is non-empty. No email address SHALL be committed to the repository. CI SHALL pass `alarm_email` from the `prod` environment variable `ALARM_EMAIL`, so CI and local applies agree.

#### Scenario: Failed run notifies

- **WHEN** a scheduled run fails
- **THEN** both alarms enter ALARM and publish to the topic

#### Scenario: DLQ alarm persists until drained

- **WHEN** the dead-letter queue still holds a message
- **THEN** the DLQ alarm stays in ALARM, and it returns to OK once the queue is empty

#### Scenario: No subscription without a variable

- **WHEN** `alarm_email` is empty
- **THEN** `tofu plan` shows the topic and alarms and no `aws_sns_topic_subscription`
