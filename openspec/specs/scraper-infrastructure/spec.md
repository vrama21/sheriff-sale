# scraper-infrastructure Specification

## Purpose

The AWS resources behind the daily New Jersey sheriff sale scraper: the `nj-sheriff-sale` archive bucket, the Lambda and its IAM role, dead-letter queue, schedule, and log group, plus their names and protection rules.

## Requirements

### Requirement: Archive bucket

OpenTofu SHALL manage an S3 bucket named `nj-sheriff-sale`. The name SHALL NOT be derived from the environment. The resource SHALL set `lifecycle { prevent_destroy = true }` and declare AES256 default server-side encryption.

#### Scenario: Accidental destroy

- **WHEN** a plan would destroy or replace `nj-sheriff-sale`
- **THEN** OpenTofu refuses the plan with a `prevent_destroy` error

#### Scenario: Steady state

- **WHEN** `tofu plan` runs after cutover
- **THEN** the plan shows no changes to `nj-sheriff-sale` or its encryption configuration

### Requirement: Archive data is preserved through the migration

Every object in `nj-sheriff-sale-dev` SHALL be copied into `nj-sheriff-sale` with the same keys, using a server-side copy (`aws s3 sync`). The copy SHALL run after `SheriffSaleStack` is deleted, so the old Lambda cannot write new objects during or after it. `nj-sheriff-sale-dev` SHALL survive the CloudFormation stack deletion. It SHALL NOT be deleted until the copy is verified and the grace period has passed.

#### Scenario: Old bucket survives the stack deletion

- **WHEN** `SheriffSaleStack` is deleted during cutover
- **THEN** `nj-sheriff-sale-dev` still exists with 47,498 objects totalling 1,249,289,548 bytes

#### Scenario: Copy is verified

- **WHEN** the sync into `nj-sheriff-sale` finishes
- **THEN** `nj-sheriff-sale` has the same object count and total size as `nj-sheriff-sale-dev`, and a repeat `aws s3 sync --dryrun` lists nothing to copy

#### Scenario: Old bucket retired

- **WHEN** the grace period has passed after a verified copy
- **THEN** `nj-sheriff-sale-dev` is emptied and deleted

### Requirement: Scraper writes to the fixed archive bucket

The scraper SHALL write scraped HTML to `nj-sheriff-sale` no matter what `ENV` is set to.

#### Scenario: Save from the deployed Lambda

- **WHEN** the deployed scraper saves a page
- **THEN** the object is written to `nj-sheriff-sale` under `<keyPrefix>/<YYYY-MM-DD>/<keySuffix>`

### Requirement: Scraper Lambda function

OpenTofu SHALL manage a Lambda function named `new-jersey-sheriff-sale-scraper`. It SHALL use runtime `nodejs24.x`, handler `index.handler`, 512 MB memory, a 900-second timeout, and the x86_64 architecture. Its code SHALL be the esbuild bundle of `backend/src/handlers/newJerseySheriffSaleScraperHandler.ts`. Its environment SHALL contain exactly `DATABASE_URL` and `ENV`. `DATABASE_URL` SHALL come from a `sensitive` input variable, and `ENV` SHALL be `prod`.

#### Scenario: Function configuration after apply

- **WHEN** `aws lambda get-function-configuration` is run against `new-jersey-sheriff-sale-scraper` after apply
- **THEN** it reports runtime `nodejs24.x`, handler `index.handler`, memory 512, timeout 900, and environment keys `DATABASE_URL` and `ENV` only

#### Scenario: Manual invocation

- **WHEN** the function is invoked manually after cutover
- **THEN** it returns successfully and writes scraped HTML objects under today's date to `nj-sheriff-sale`

#### Scenario: Code change

- **WHEN** the handler source changes and the bundle is rebuilt
- **THEN** `tofu plan` shows an in-place update of the function code driven by the bundle hash

### Requirement: Scraper IAM role and permissions

OpenTofu SHALL manage an IAM role named `new-jersey-sheriff-sale-scraper-role` that only `lambda.amazonaws.com` can assume. The role SHALL have the AWS managed policy `service-role/AWSLambdaBasicExecutionRole` attached. It SHALL have inline policies granting `s3:GetObject` and `s3:PutObject` on `nj-sheriff-sale/*`, and `sqs:SendMessage` on the dead-letter queue.

#### Scenario: Least-privilege S3 access

- **WHEN** the role's inline policies are inspected
- **THEN** S3 actions are scoped to objects in `nj-sheriff-sale` and SQS actions to the dead-letter queue ARN only

### Requirement: Dead-letter queue

OpenTofu SHALL manage an SQS queue named `new-jersey-sheriff-sale-scraper-dlq` with a 14-day (1,209,600-second) message retention period and SQS-managed server-side encryption. The queue SHALL be configured as the Lambda function's dead-letter target.

#### Scenario: Queue configuration

- **WHEN** the queue's attributes are read after apply
- **THEN** `MessageRetentionPeriod` is 1209600, `SqsManagedSseEnabled` is true, and the function's `DeadLetterConfig.TargetArn` equals the queue ARN

### Requirement: Daily schedule

OpenTofu SHALL manage an EventBridge rule on the default event bus named `new-jersey-sheriff-sale-scraper-rule` with schedule `cron(0 0 * * ? *)`. The rule SHALL be enabled and have a single target: the scraper function. A Lambda permission SHALL allow `events.amazonaws.com` to invoke the function, scoped to that rule's ARN.

#### Scenario: Scheduled run

- **WHEN** 00:00 UTC passes after cutover
- **THEN** the function is invoked once by the rule and a new log stream appears in `/aws/lambda/new-jersey-sheriff-sale-scraper`

### Requirement: Scraper log group

OpenTofu SHALL create and manage the log group `/aws/lambda/new-jersey-sheriff-sale-scraper` before the function, so that Lambda does not create it outside OpenTofu. The old log group `/aws/lambda/new-jersey-sheriff-sale-scraper-dev` SHALL be kept, outside OpenTofu, so the pre-migration history stays searchable in CloudWatch alongside the new group.

#### Scenario: Log group owned by OpenTofu

- **WHEN** the function is first invoked after apply
- **THEN** its logs go to the OpenTofu-managed `/aws/lambda/new-jersey-sheriff-sale-scraper`, and `tofu plan` shows no changes

### Requirement: Single environment with env-less names

AWS SHALL host exactly one deployed environment. No resource name SHALL contain an environment name such as `prod` or `dev`. The environment SHALL appear only as the Lambda's `ENV` value (`prod`), taken from a single local in the root config.

#### Scenario: Names after cutover

- **WHEN** the scraper resources are listed after cutover
- **THEN** the function, role, queue, rule, and log group are named `new-jersey-sheriff-sale-scraper`, `…-role`, `…-dlq`, `…-rule`, and `/aws/lambda/new-jersey-sheriff-sale-scraper`, and no OpenTofu-managed resource name ends in `-prod` or `-dev`
