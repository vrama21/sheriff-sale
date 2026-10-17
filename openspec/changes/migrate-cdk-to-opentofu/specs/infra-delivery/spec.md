## ADDED Requirements

### Requirement: Lambda bundle build
The `backend` workspace `build` script SHALL type-check the sources and SHALL use esbuild to bundle `src/handlers/newJerseySheriffSaleScraperHandler.ts` into `backend/dist/index.js`. The bundle SHALL be a single CommonJS file targeting Node 24 with `@aws-sdk/*` included. The bundle SHALL export `handler`. The build SHALL NOT require AWS credentials, `DATABASE_URL`, or `ENV`.

#### Scenario: Build on a feature branch
- **WHEN** the CI `build` job runs on a non-main branch with placeholder secrets
- **THEN** `npm run build` succeeds and `backend/dist/index.js` exists

#### Scenario: Handler export
- **WHEN** `backend/dist/index.js` is required in Node 24
- **THEN** it exposes a `handler` function

### Requirement: CI applies infrastructure on main only
The CI workflow SHALL run `tofu init` and `tofu apply -auto-approve` in `infra/` only on pushes to `main`, in the `prod` GitHub environment, after the `migrate` job succeeds. It SHALL use the Lambda bundle produced by the `build` job of the same run. CI SHALL NOT run any OpenTofu command on other branches.

#### Scenario: Push to main
- **WHEN** a commit lands on `main` and `build` and `migrate` succeed
- **THEN** the infrastructure job applies `infra/` using the `build` job's bundle and the `prod` environment's AWS and `DATABASE_URL` secrets

#### Scenario: Push to a feature branch
- **WHEN** a commit is pushed to a non-main branch
- **THEN** no OpenTofu command runs and no AWS credentials are used

### Requirement: Single prod GitHub environment
CI deploy jobs (`migrate`, `deploy-backend`, `deploy-frontend`) SHALL use the GitHub environment `prod`. It SHALL hold the secrets `DATABASE_URL` and `VERCEL_TOKEN`, and the variables `ENV=prod`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` (identifiers, not credentials). It SHALL NOT hold AWS credentials. The `dev` GitHub environment SHALL be deleted once `prod` is in use.

#### Scenario: Deploy jobs use prod
- **WHEN** the workflow runs on `main`
- **THEN** every deploy job runs in the `prod` environment with `ENV=prod`

#### Scenario: No dev environment remains
- **WHEN** the repository's GitHub environments are listed after cutover
- **THEN** `dev` is not among them

### Requirement: CI authenticates to AWS with OIDC
CI SHALL get AWS credentials only by assuming the IAM role `sheriff-sale-github-actions` through GitHub's OIDC provider. The role SHALL trust only tokens with audience `sts.amazonaws.com` and subject `repo:vrama21/sheriff-sale:environment:prod`. Its permissions SHALL be limited to this project's resource ARNs: the state bucket and its objects, the archive bucket's configuration (no object access), the scraper function, the scraper and CI roles, the OIDC provider, the DLQ, the schedule rule, and the scraper log group. No long-lived AWS access keys SHALL be stored in GitHub, and the `cicd-pipeline-deployer` IAM user SHALL be deleted.

#### Scenario: Deploy job assumes the role
- **WHEN** `deploy-backend` runs on `main`
- **THEN** its AWS identity is `assumed-role/sheriff-sale-github-actions/…`, and `tofu apply` completes without access errors

#### Scenario: Other contexts cannot assume the role
- **WHEN** a job outside the repo's `prod` environment (e.g. a feature-branch job with no environment) requests credentials for the role
- **THEN** `AssumeRoleWithWebIdentity` is denied

#### Scenario: No AWS keys remain
- **WHEN** the repository's secrets (repository and environment level) and the account's IAM users are listed after handover
- **THEN** no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` secrets exist and `cicd-pipeline-deployer` does not exist

### Requirement: Manual cutover before CI takes over
The cutover from CloudFormation to OpenTofu SHALL be run by hand from a developer machine, in this order:
1. Bootstrap state.
2. Retain the old archive bucket.
3. Delete the stack.
4. Copy the archive and verify the copy.
5. Create the rest.

CI SHALL NOT run OpenTofu until the cutover is verified. The CDK deploy step SHALL be removed from CI before the stack is touched.

#### Scenario: CDK deploy disabled first
- **WHEN** the CloudFormation stack is modified for the cutover
- **THEN** the CI workflow on `main` no longer contains a CDK deploy step

#### Scenario: CI enabled after verification
- **WHEN** the OpenTofu CI job is added to the workflow
- **THEN** `tofu plan` from a developer machine already reports no changes against live infrastructure

### Requirement: CDK toolchain and legacy resources removed
After cutover, the repository SHALL NOT contain the CDK app (`backend/bin/`, `backend/lib/`, `backend/cdk.json`), CDK npm dependencies, CDK-specific turbo outputs or env vars, or CDK instructions in the READMEs. The `SheriffSaleStack` and `CDKToolkit` CloudFormation stacks SHALL be deleted from account 590184139982 in us-east-2. After the archive grace period, `nj-sheriff-sale-dev` and `/aws/lambda/new-jersey-sheriff-sale-scraper-dev` SHALL also be deleted.

#### Scenario: No CDK references remain
- **WHEN** the repository (excluding `node_modules`, lockfiles, and `openspec/`) is searched for `aws-cdk` and `cdk.out`
- **THEN** no matches are found

#### Scenario: No CDK stacks remain
- **WHEN** `aws cloudformation list-stacks` is run in us-east-2 for active stacks
- **THEN** neither `SheriffSaleStack` nor `CDKToolkit` is listed

#### Scenario: No dev resources remain
- **WHEN** the account's S3 buckets and `/aws/lambda/` log groups are listed after the grace period
- **THEN** neither `nj-sheriff-sale-dev` nor `/aws/lambda/new-jersey-sheriff-sale-scraper-dev` exists
