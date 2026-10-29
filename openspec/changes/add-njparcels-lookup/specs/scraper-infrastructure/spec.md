## ADDED Requirements

### Requirement: Parcels Lambda function

OpenTofu SHALL manage a Lambda function named `new-jersey-parcels`. It SHALL use:

- runtime `nodejs24.x`, handler `index.handler`, 512 MB memory, a 900-second timeout, and the x86_64 architecture;
- as its code, the esbuild bundle of `backend/src/modules/njParcels/handler.ts`;
- an environment containing exactly `DATABASE_URL`, from the same `sensitive` input variable as the scraper function;
- the role `new-jersey-sheriff-sale-scraper-role`;
- `new-jersey-sheriff-sale-scraper-dlq` as its dead-letter target, with 0 asynchronous retries.

#### Scenario: Function configuration after apply

- **WHEN** `aws lambda get-function-configuration` is run against `new-jersey-parcels` after apply
- **THEN** it reports runtime `nodejs24.x`, handler `index.handler`, memory 512, timeout 900, the scraper's role, the scraper's DLQ as its dead-letter target, and environment key `DATABASE_URL` only

#### Scenario: Other functions unaffected

- **WHEN** `tofu plan` runs after the parcels resources are added, with no change to the other handlers
- **THEN** the plan shows no changes to `new-jersey-sheriff-sale-scraper` or `new-jersey-clerk-records`

### Requirement: Parcels archive prefix

The parcels function SHALL write raw property pages to `nj-sheriff-sale` under the `njparcels/` key prefix. It SHALL NOT need any IAM permission beyond what `new-jersey-sheriff-sale-scraper-role` already grants.

#### Scenario: Archive write

- **WHEN** the deployed parcels function saves a property page
- **THEN** the object is written to `nj-sheriff-sale` under `njparcels/<code>/<YYYY-MM-DD>/`

### Requirement: Parcels daily schedule

OpenTofu SHALL manage an EventBridge rule that invokes `new-jersey-parcels` daily at `cron(0 4 * * ? *)`, after the scraper and clerk-records schedules. A Lambda permission SHALL let only that rule invoke it.

#### Scenario: Schedule configuration

- **WHEN** the rule is read after apply
- **THEN** its schedule expression is `cron(0 4 * * ? *)` and its only target is `new-jersey-parcels`

### Requirement: Parcels log group

OpenTofu SHALL manage a CloudWatch log group named `/aws/lambda/new-jersey-parcels`, created before the function, with the same retention as the scraper's log group.

#### Scenario: Logs land in the managed group

- **WHEN** the function runs after apply
- **THEN** its logs are written to `/aws/lambda/new-jersey-parcels`, and the group's retention matches the scraper's
