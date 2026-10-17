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
The CI workflow SHALL run `tofu init` and `tofu apply -auto-approve` in `infra/` only on pushes to `main`, in the `dev` environment, after the `migrate` job succeeds. It SHALL use the Lambda bundle produced by the `build` job of the same run. CI SHALL NOT run any OpenTofu command on other branches.

#### Scenario: Push to main
- **WHEN** a commit lands on `main` and `build` and `migrate` succeed
- **THEN** the infrastructure job applies `infra/` using the `build` job's bundle and the `dev` environment's AWS and `DATABASE_URL` secrets

#### Scenario: Push to a feature branch
- **WHEN** a commit is pushed to a non-main branch
- **THEN** no OpenTofu command runs and no AWS credentials are used

### Requirement: Manual cutover before CI takes over
The cutover from CloudFormation to OpenTofu SHALL be run by hand from a developer machine. The steps are: bootstrap state, retain the archive bucket, import it, delete the stack, and create the rest. CI SHALL NOT run OpenTofu until the cutover is verified. The CDK deploy step SHALL be removed from CI before the stack is touched.

#### Scenario: CDK deploy disabled first
- **WHEN** the CloudFormation stack is modified for the cutover
- **THEN** the CI workflow on `main` no longer contains a CDK deploy step

#### Scenario: CI enabled after verification
- **WHEN** the OpenTofu CI job is added to the workflow
- **THEN** `tofu plan` from a developer machine already reports no changes against live infrastructure

### Requirement: CDK toolchain removed
After cutover, the repository SHALL NOT contain the CDK app (`backend/bin/`, `backend/lib/`, `backend/cdk.json`), CDK npm dependencies, CDK-specific turbo outputs or env vars, or CDK instructions in the READMEs. The `SheriffSaleStack` and `CDKToolkit` CloudFormation stacks SHALL be deleted from account 590184139982 in us-east-2.

#### Scenario: No CDK references remain
- **WHEN** the repository (excluding `node_modules`, lockfiles, and `openspec/`) is searched for `aws-cdk` and `cdk.out`
- **THEN** no matches are found

#### Scenario: No CDK stacks remain
- **WHEN** `aws cloudformation list-stacks` is run in us-east-2 for active stacks
- **THEN** neither `SheriffSaleStack` nor `CDKToolkit` is listed
