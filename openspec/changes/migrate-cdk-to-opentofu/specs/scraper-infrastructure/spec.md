## ADDED Requirements

### Requirement: Scrape archive bucket is preserved
The existing S3 bucket `nj-sheriff-sale-dev` SHALL be imported into OpenTofu state, not recreated. The migration SHALL keep all of its objects. Its resource SHALL set `lifecycle { prevent_destroy = true }`. Its AES256 default encryption SHALL be declared so that a plan after import shows no changes to the bucket.

#### Scenario: Import shows no drift
- **WHEN** the bucket is imported and `tofu plan` runs
- **THEN** the plan shows no create, replace, or destroy for the bucket and no changes to its live settings

#### Scenario: Objects survive the CloudFormation stack deletion
- **WHEN** `SheriffSaleStack` is deleted during cutover
- **THEN** `nj-sheriff-sale-dev` still exists with the same object count as before the deletion

#### Scenario: Accidental destroy
- **WHEN** a plan would destroy or replace `nj-sheriff-sale-dev`
- **THEN** OpenTofu refuses the plan with a `prevent_destroy` error

### Requirement: Scraper Lambda function
OpenTofu SHALL manage a Lambda function named `new-jersey-sheriff-sale-scraper-<env>`. It SHALL use runtime `nodejs24.x`, handler `index.handler`, 512 MB memory, a 900-second timeout, and the x86_64 architecture. Its code SHALL be the esbuild bundle of `backend/src/handlers/newJerseySheriffSaleScraperHandler.ts`. Its environment SHALL contain exactly `DATABASE_URL` and `ENV`. `DATABASE_URL` SHALL come from a `sensitive` input variable.

#### Scenario: Function configuration after apply
- **WHEN** `aws lambda get-function-configuration` is run against the function after apply
- **THEN** it reports runtime `nodejs24.x`, handler `index.handler`, memory 512, timeout 900, and environment keys `DATABASE_URL` and `ENV` only

#### Scenario: Manual invocation
- **WHEN** the function is invoked manually after cutover
- **THEN** it returns successfully and writes scraped HTML objects to `nj-sheriff-sale-dev`

#### Scenario: Code change
- **WHEN** the handler source changes and the bundle is rebuilt
- **THEN** `tofu plan` shows an in-place update of the function code driven by the bundle hash

### Requirement: Scraper IAM role and permissions
OpenTofu SHALL manage an IAM role named `new-jersey-sheriff-sale-scraper-role-<env>` that only `lambda.amazonaws.com` can assume. The role SHALL have the AWS managed policy `service-role/AWSLambdaBasicExecutionRole` attached. It SHALL have inline policies granting `s3:GetObject` and `s3:PutObject` on `nj-sheriff-sale-<env>/*`, and `sqs:SendMessage` on the dead-letter queue. The role SHALL NOT keep the CDK-generated policy name `NewJerseySheriffSaleScraperRoleDefaultPolicy05FC6E9E`.

#### Scenario: Least-privilege S3 access
- **WHEN** the role's inline policies are inspected
- **THEN** S3 actions are scoped to objects in `nj-sheriff-sale-<env>` and SQS actions to the dead-letter queue ARN only

### Requirement: Dead-letter queue
OpenTofu SHALL manage an SQS queue named `new-jersey-sheriff-sale-scraper-dlq-<env>` with a 14-day (1,209,600-second) message retention period and SQS-managed server-side encryption. The queue SHALL be configured as the Lambda function's dead-letter target.

#### Scenario: Queue configuration
- **WHEN** the queue's attributes are read after apply
- **THEN** `MessageRetentionPeriod` is 1209600, `SqsManagedSseEnabled` is true, and the function's `DeadLetterConfig.TargetArn` equals the queue ARN

### Requirement: Daily schedule
OpenTofu SHALL manage an EventBridge rule on the default event bus named `new-jersey-sheriff-sale-scraper-rule-<env>` with schedule `cron(0 0 * * ? *)`. The rule SHALL be enabled and have a single target: the scraper function. A Lambda permission SHALL allow `events.amazonaws.com` to invoke the function, scoped to that rule's ARN.

#### Scenario: Scheduled run
- **WHEN** 00:00 UTC passes after cutover
- **THEN** the function is invoked once by the rule and a new log stream appears in `/aws/lambda/new-jersey-sheriff-sale-scraper-<env>`

### Requirement: Scraper log group is adopted
The existing log group `/aws/lambda/new-jersey-sheriff-sale-scraper-<env>` SHALL be imported into OpenTofu state, not recreated. Its existing log streams SHALL be retained.

#### Scenario: Import of the existing log group
- **WHEN** `tofu apply` runs with the log group's import block
- **THEN** the log group is adopted into state without a create error and existing log streams remain

### Requirement: Environment naming
Resource names SHALL derive their `-<env>` suffix from a single local value in the root config, set to `dev`.

#### Scenario: Names match the pre-migration names
- **WHEN** the plan for the recreated resources is reviewed
- **THEN** the function, role, queue, and rule names equal their names in the deleted `SheriffSaleStack`
