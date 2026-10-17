## Why

The backend's infrastructure is an AWS CDK app (`SheriffSaleStack`) that can no longer deploy: the CI `deploy-backend` job fails in synth (`Cannot read properties of undefined (reading 'fileExists')`), and the stack has not changed since 2024-07-01. The scraper Lambda also runs on `nodejs20.x`, which AWS deprecated on 2026-04-30 and will soon block from being created or updated. Moving to an OpenTofu config gives a working, readable, plan-before-apply workflow and a natural point to move the runtime to Node 24, without losing the 47k-object / 1.25 GB scrape archive.

It is also the point to settle the environment model: AWS hosts exactly one deployed environment, `prod`, and all testing happens locally. The existing resources are named `-dev`, so the rebuild renames them.

## What Changes

- Add a single OpenTofu root config in `infra/` that owns all backend AWS resources for the `prod` environment.
- Add an S3 state bucket, created by the AWS provider in that same config, with versioning, `prevent_destroy`, and S3-native lockfile locking. Bootstrap it once with local state, then migrate the state into the bucket.
- Move the scrape archive from `nj-sheriff-sale-dev` into a new bucket with no env in its name, `nj-sheriff-sale` (`prevent_destroy`), using a server-side `aws s3 sync`. Keep `nj-sheriff-sale-dev` out of the CloudFormation deletion (Retain), and delete it only after the copy is verified and a grace period has passed.
- `saveHtmlToS3.ts` writes to the fixed bucket name `nj-sheriff-sale` instead of `nj-sheriff-sale-${ENV}`.
- **BREAKING** (infra only): Delete `SheriffSaleStack` and recreate the scraper Lambda, its IAM role and policies, the SQS dead-letter queue, the EventBridge schedule rule and target, the Lambda invoke permission, and the log group with OpenTofu, under readable names with no environment in them (e.g. `new-jersey-sheriff-sale-scraper`). CDK-generated names are dropped. The old `-dev` log group is kept, unmanaged, so its history stays searchable.
- Move the Lambda runtime from `nodejs20.x` to `nodejs24.x`. Bundle the handler with esbuild (including `@aws-sdk/*`) instead of CDK's `NodejsFunction`. Drop `AWS_NODEJS_CONNECTION_REUSE_ENABLED`.
- Replace the CI `deploy-backend` CDK step with `tofu apply` on `main`, fed by an esbuild bundle built in the `build` job.
- **BREAKING** (CI): Replace the GitHub environment `dev` with `prod` (`ENV=prod`), and delete `dev`.
- CI authenticates to AWS with GitHub OIDC, assuming an IAM role (`sheriff-sale-github-actions`) scoped to this project's resources. The long-lived `AdministratorAccess` keys of the `cicd-pipeline-deployer` IAM user are retired, along with the user and the AWS key secrets in GitHub.
- Pin OpenTofu with mise.
- **BREAKING** (tooling): Remove the CDK app (`backend/bin`, `backend/lib`, `cdk.json`, `aws-cdk`/`aws-cdk-lib`/`constructs` dependencies, CDK turbo outputs and env) and delete the `CDKToolkit` bootstrap stack.

## Capabilities

### New Capabilities
- `infra-state`: Where OpenTofu state lives, how it is locked and protected, and how the state bucket is bootstrapped from the same config.
- `scraper-infrastructure`: The AWS resources the scraper needs (the archive bucket and the migration of its data, Lambda, IAM, DLQ, daily schedule, log group), their `prod` names, and their protection rules.
- `infra-delivery`: How the Lambda bundle is built and how infrastructure changes are applied (CI on `main` in the `prod` GitHub environment, manual cutover), replacing the CDK toolchain.

### Modified Capabilities
<!-- None: openspec/specs/ is empty; this is the first change in the repo. -->

## Impact

- **AWS (account 590184139982, us-east-2)**:
  - `SheriffSaleStack` and `CDKToolkit` are deleted.
  - The scraper resources are recreated with env-less names, so the scraper is briefly unavailable between daily runs.
  - New buckets: `nj-sheriff-sale` (the archive data is copied in) and the state bucket.
  - `nj-sheriff-sale-dev` is deleted after the grace period. The `-dev` log group is kept.
- **Code**:
  - New `infra/`.
  - `backend/src/services/newJerseySheriffSale/saveHtmlToS3.ts` uses the fixed bucket name.
  - `backend/package.json` build script changes (esbuild in place of `cdk synth`).
  - `backend/bin/`, `backend/lib/`, `backend/cdk.json`, and `packages/tsconfig/awscdk.json` are removed or replaced.
  - `turbo.json`, `README.md`, and `backend/README.md` are updated.
- **CI**: `.github/workflows/cicd.yml`:
  - The `build` job also uploads the Lambda bundle.
  - `deploy-backend` runs OpenTofu.
  - Jobs use `environment: prod`. The `prod` GitHub environment needs the secrets `DATABASE_URL` and `VERCEL_TOKEN` re-entered, because GitHub can't copy secret values. `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` become plain environment variables. It holds no AWS keys.
  - `deploy-backend` gets AWS credentials through OIDC (`id-token: write`, `aws-actions/configure-aws-credentials`).
- **Local development**: local scraper runs write to `nj-sheriff-sale`, the prod bucket, just as they already use the hosted Railway database. Isolating local runs is out of scope.
- **Dependencies**: removes `aws-cdk`, `aws-cdk-lib`, `constructs`, and `source-map-support` (if unused elsewhere). Uses the existing root `esbuild`. Adds OpenTofu (via mise) and the `hashicorp/aws` and `hashicorp/archive` providers.
- **Secrets**: `DATABASE_URL` moves from the CloudFormation template into the OpenTofu state, stored in a private, versioned S3 bucket.
