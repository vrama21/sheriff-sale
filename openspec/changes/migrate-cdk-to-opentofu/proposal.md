## Why

The backend's infrastructure is an AWS CDK app (`SheriffSaleStack`) that can no longer deploy: the CI `deploy-backend` job fails in synth (`Cannot read properties of undefined (reading 'fileExists')`), and the stack has not changed since 2024-07-01. The scraper Lambda also runs on `nodejs20.x`, which AWS deprecated on 2026-04-30 and will soon block from being created or updated. Moving to an OpenTofu config gives a working, readable, plan-before-apply workflow and a natural point to move the runtime to Node 24, without risking the 47k-object / 1.25 GB scrape archive in `nj-sheriff-sale-dev`.

## What Changes

- Add a single OpenTofu root config in `infra/` that owns all backend AWS resources for the `dev` environment.
- Add an S3 state bucket, created by the AWS provider in that same config, with versioning, `prevent_destroy`, and S3-native lockfile locking. Bootstrap it once with local state, then migrate the state into the bucket.
- Preserve the S3 bucket `nj-sheriff-sale-dev` and its contents: retain it out of the CloudFormation stack, import it into OpenTofu, and protect it with `prevent_destroy`.
- Import the existing, unmanaged log group `/aws/lambda/new-jersey-sheriff-sale-scraper-dev`.
- **BREAKING** (infra only): Delete `SheriffSaleStack` and recreate the scraper Lambda, its IAM role and policies, the SQS dead-letter queue, the EventBridge schedule rule and target, and the Lambda invoke permission with OpenTofu. Readable physical names stay the same. CDK-generated names (`NewJerseySheriffSaleScraperRoleDefaultPolicy05FC6E9E`, the long permission statement ID) are replaced.
- Move the Lambda runtime from `nodejs20.x` to `nodejs24.x`. Bundle the handler with esbuild (including `@aws-sdk/*`) instead of CDK's `NodejsFunction`. Drop `AWS_NODEJS_CONNECTION_REUSE_ENABLED`.
- Replace the CI `deploy-backend` CDK step with `tofu apply` on `main`, fed by an esbuild bundle built in the `build` job.
- Pin OpenTofu with mise.
- **BREAKING** (tooling): Remove the CDK app (`backend/bin`, `backend/lib`, `cdk.json`, `aws-cdk`/`aws-cdk-lib`/`constructs` dependencies, CDK turbo outputs and env) and delete the `CDKToolkit` bootstrap stack.

## Capabilities

### New Capabilities
- `infra-state`: Where OpenTofu state lives, how it is locked and protected, and how the state bucket is bootstrapped from the same config.
- `scraper-infrastructure`: The AWS resources the scraper needs (the preserved archive bucket, Lambda, IAM, DLQ, daily schedule, log group), their names, and their protection rules.
- `infra-delivery`: How the Lambda bundle is built and how infrastructure changes are applied (CI on `main`, manual cutover), replacing the CDK toolchain.

### Modified Capabilities
<!-- None: openspec/specs/ is empty; this is the first change in the repo. -->

## Impact

- **AWS (account 590184139982, us-east-2)**: `SheriffSaleStack` and `CDKToolkit` are deleted. The Lambda, role, policies, DLQ, rule, and permission are recreated, so the scraper is briefly unavailable between daily runs. `nj-sheriff-sale-dev` and the log group are untouched. A new state bucket is added.
- **Code**: new `infra/`. `backend/package.json` build script changes (esbuild in place of `cdk synth`). `backend/bin/`, `backend/lib/`, `backend/cdk.json`, and `packages/tsconfig/awscdk.json` are removed or replaced. `turbo.json`, `README.md`, and `backend/README.md` are updated.
- **CI**: `.github/workflows/cicd.yml`: the `build` job also uploads the Lambda bundle, and `deploy-backend` runs OpenTofu. Uses the existing `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`DATABASE_URL` secrets in the `dev` environment.
- **Dependencies**: removes `aws-cdk`, `aws-cdk-lib`, `constructs`, and `source-map-support` (if unused elsewhere). Uses the existing root `esbuild`. Adds OpenTofu (via mise) and the `hashicorp/aws` and `hashicorp/archive` providers.
- **Secrets**: `DATABASE_URL` moves from the CloudFormation template into the OpenTofu state, stored in a private, versioned S3 bucket.
