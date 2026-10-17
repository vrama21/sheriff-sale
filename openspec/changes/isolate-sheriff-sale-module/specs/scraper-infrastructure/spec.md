## MODIFIED Requirements

### Requirement: Scraper Lambda function
OpenTofu SHALL manage a Lambda function named `new-jersey-sheriff-sale-scraper`. It SHALL use runtime `nodejs24.x`, handler `index.handler`, 512 MB memory, a 900-second timeout, and the x86_64 architecture. Its code SHALL be the esbuild bundle of `backend/src/modules/sheriffSale/handler.ts`. Its environment SHALL contain exactly `DATABASE_URL` and `ENV`. `DATABASE_URL` SHALL come from a `sensitive` input variable, and `ENV` SHALL be `prod`.

#### Scenario: Function configuration after apply
- **WHEN** `aws lambda get-function-configuration` is run against `new-jersey-sheriff-sale-scraper` after apply
- **THEN** it reports runtime `nodejs24.x`, handler `index.handler`, memory 512, timeout 900, and environment keys `DATABASE_URL` and `ENV` only

#### Scenario: Manual invocation
- **WHEN** the function is invoked manually after cutover
- **THEN** it returns successfully and writes scraped HTML objects under today's date to `nj-sheriff-sale`

#### Scenario: Code change
- **WHEN** the handler source changes and the bundle is rebuilt
- **THEN** `tofu plan` shows an in-place update of the function code driven by the bundle hash
