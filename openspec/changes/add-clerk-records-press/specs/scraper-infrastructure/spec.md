## ADDED Requirements

### Requirement: Clerk records Lambda function

OpenTofu SHALL manage a Lambda function named `new-jersey-clerk-records`. It SHALL use runtime `nodejs24.x`, handler `index.handler`, 512 MB memory, a 900-second timeout, and the x86_64 architecture. Its code SHALL be the esbuild bundle of `backend/src/modules/clerkRecords/handler.ts`. Its environment SHALL contain exactly `DATABASE_URL`, from the same `sensitive` input variable as the scraper function. It SHALL run as `new-jersey-sheriff-sale-scraper-role`, with `new-jersey-sheriff-sale-scraper-dlq` as its dead-letter target and 0 asynchronous retries.

#### Scenario: Function configuration after apply

- **WHEN** `aws lambda get-function-configuration` is run against `new-jersey-clerk-records` after apply
- **THEN** it reports runtime `nodejs24.x`, handler `index.handler`, memory 512, timeout 900, the scraper's role, the scraper's DLQ as its dead-letter target, and environment key `DATABASE_URL` only

#### Scenario: Scraper unaffected

- **WHEN** `tofu plan` runs after the clerk records resources are added, with no change to the sheriff-sale handler
- **THEN** the plan shows no changes to `new-jersey-sheriff-sale-scraper`

### Requirement: Clerk records archive prefix

The clerk records function SHALL write raw result pages to `nj-sheriff-sale` under the `clerk-records/` key prefix. It SHALL NOT need any IAM permission beyond what `new-jersey-sheriff-sale-scraper-role` already grants.

#### Scenario: Archive write

- **WHEN** the deployed clerk records function saves a result page
- **THEN** the object is written to `nj-sheriff-sale` under `clerk-records/<county-slug>/<YYYY-MM-DD>/`

### Requirement: Clerk records daily schedule

OpenTofu SHALL manage an EventBridge rule that invokes `new-jersey-clerk-records` daily at `cron(0 2 * * ? *)`, two hours after the scraper's schedule, with a Lambda permission that lets only that rule invoke it.

#### Scenario: Schedule configuration

- **WHEN** the rule is read after apply
- **THEN** its schedule expression is `cron(0 2 * * ? *)` and its only target is `new-jersey-clerk-records`

### Requirement: Clerk records log group

OpenTofu SHALL manage a CloudWatch log group named `/aws/lambda/new-jersey-clerk-records` with the same retention as the scraper's log group.

#### Scenario: Logs land in the managed group

- **WHEN** the function runs after apply
- **THEN** its logs are written to `/aws/lambda/new-jersey-clerk-records` and the group's retention matches the scraper's
