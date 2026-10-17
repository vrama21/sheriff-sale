## Context

The backend runs as one CloudFormation stack, `SheriffSaleStack` (account 590184139982, us-east-2), synthesized from the CDK app in `backend/bin` and `backend/lib`. A live read on 2026-10-16 showed:

| CFN logical ID | Type | Physical ID | Fate |
|---|---|---|---|
| `NewJerseySheriffSaleBucketA75A18D1` | S3 bucket | `nj-sheriff-sale-dev` (47,498 objects, 1.25 GB) | **keep, import** |
| `NewJerseySheriffSaleScraper80654AD5` | Lambda | `new-jersey-sheriff-sale-scraper-dev` (nodejs20.x) | delete, recreate |
| `NewJerseySheriffSaleScraperRoleD78E4208` | IAM role (+ inline `NewJerseySheriffSaleScraperPolicy`) | `new-jersey-sheriff-sale-scraper-role-dev` | delete, recreate |
| `NewJerseySheriffSaleScraperRoleDefaultPolicy05FC6E9E` | IAM policy (inline on role) | `sqs:SendMessage` on DLQ | delete, recreate under a readable name |
| `NewJerseySheriffSaleScraperDLQEEECC262` | SQS | `new-jersey-sheriff-sale-scraper-dlq-dev` (0 messages) | delete, recreate |
| `NewJerseySheriffSaleScraperRule058BA2B7` | EventBridge rule | `new-jersey-sheriff-sale-scraper-rule-dev`, `cron(0 0 * * ? *)` | delete, recreate |
| `…RuleAllowEventRule…3A8ABCD33B5A41E9` | Lambda permission | generated statement ID | delete, recreate |
| `CDKMetadata` | CDK metadata | none | drop |

Outside the stack:
- Log group `/aws/lambda/new-jersey-sheriff-sale-scraper-dev`: created by Lambda, never expires, 57 MB.
- `CDKToolkit` bootstrap stack (v20): its assets bucket holds the current Lambda zip.

All resources use `DeletionPolicy: Delete`. The bucket also has AWS-default settings that CDK never declared: all four Block Public Access flags on, and `BucketOwnerEnforced` object ownership.

CI's `deploy-backend` job fails in CDK synth today. `main` is the only branch that deploys, through the `dev` GitHub environment, with long-lived AWS keys.

## Goals / Non-Goals

**Goals:**
- One OpenTofu root config (`infra/`) owns all backend AWS resources for `dev`, plus its own state bucket.
- `nj-sheriff-sale-dev` and all its objects survive with no replacement.
- The scraper keeps its readable resource names and daily schedule, moving to `nodejs24.x`.
- CI applies infrastructure on `main`. The CDK toolchain and stacks are removed.

**Non-Goals:**
- Preserving any resource other than the archive bucket (and adopting the log group).
- Multiple environments, workspaces, or modules. `env` is a single local set to `"dev"`.
- Plans on PRs or feature branches, or GitHub OIDC in place of access keys.
- Moving `DATABASE_URL` to SSM or Secrets Manager.
- Fixing the handler's `Promise.allSettled` error swallowing. Today it means the DLQ never receives anything; this is noted for a follow-up change.
- Managing the bucket's Block Public Access and ownership controls (they stay AWS defaults, not declared). The same goes for a log retention policy.

## Decisions

### D1. Keep only the bucket: import it, recreate everything else
Only the archive bucket holds data. Everything else is stateless config that OpenTofu can recreate in seconds. Recreating avoids the import pain points: the Lambda code pinned to the CDK assets bucket, CFN's inline policy structure, and import quirks that appear as changes in the plan.
- *Alternative, import all 8 resources:* needs the Lambda to keep pointing at the CDK asset zip to avoid changes. That ties the config to `CDKToolkit`, and any update risks the Node 20 update block.
- *Alternative, recreate the bucket too:* loses 1.25 GB of history. Bucket names are global, so there is also a window where someone else could take the name.

### D2. Release the bucket from CloudFormation by changing its policy to Retain
Run a direct `aws cloudformation update-stack` with the deployed template (`get-template`), editing only `DeletionPolicy` and `UpdateReplacePolicy` to `Retain` on `NewJerseySheriffSaleBucketA75A18D1`. Preview it with a change set. CDK is not involved, since CDK synth is broken. When the stack is then deleted, CloudFormation removes everything except the bucket.
- If CloudFormation rejects a policy-only update ("No updates are to be performed"), also add a harmless `Metadata` key to the bucket resource in the same edit.
- *Fallback:* delete the stack with `Delete` still set. CloudFormation can't delete a non-empty bucket, so the stack goes `DELETE_FAILED`. Then run `delete-stack --retain-resources NewJerseySheriffSaleBucketA75A18D1`. This depends on the deletion failing, so it is only a fallback.

### D3. Import with `import` blocks and protect with `prevent_destroy`
Import `aws_s3_bucket` and `aws_s3_bucket_server_side_encryption_configuration` (AES256) by bucket name. Declare `prevent_destroy` on the bucket, since it is the OpenTofu equivalent of `Retain`. Import the log group the same way. Otherwise creating it fails with `ResourceAlreadyExistsException`, because Lambda auto-created it. The `aws:cloudformation:*` tags left on the bucket are reserved. The AWS provider ignores `aws:`-prefixed tags, so they won't show in plans.
- Import blocks are kept in a dedicated `imports.tf` until cutover is verified, then removed (they are no-ops once imported).

### D4. The state bucket lives in the same root config, bootstrapped from local state
The state bucket (`sheriff-sale-tofu-state-590184139982`) is an `aws_s3_bucket` in `infra/state.tf`, with versioning, Block Public Access, AES256 default encryption, and `prevent_destroy`. Bootstrap steps:
1. Start with no `backend` block, so state is local.
2. `tofu apply -target=aws_s3_bucket.tofu_state -target=…versioning -target=…public_access_block -target=…sse`.
3. Add `backend "s3" { bucket = local.state_bucket, key = "sheriff-sale.tfstate", region = "us-east-2", use_lockfile = true }`.
4. `tofu init -migrate-state`, then delete the local `terraform.tfstate*` files.

OpenTofu ≥ 1.8 can evaluate locals and variables in the backend block, so the bucket name is written once. `use_lockfile` (OpenTofu ≥ 1.10) locks with a file in S3, so no DynamoDB table is needed.
- *Alternative, a separate bootstrap root config:* rejected, since the decision is one root config.
- *Alternative, OpenTofu client-side state encryption:* rejected for now. Anyone who can read the state bucket already has account access and can read `DATABASE_URL` from the Lambda. Revisit if access is shared more widely.

### D5. Recreate with the same readable names, drop the generated ones
Function, role, queue, and rule keep their `…-dev` names, so external references (console bookmarks, alarms, the bucket name derived in `saveHtmlToS3.ts`) do not change. The two inline policies get readable names, `s3-archive-access` and `dlq-send`. The permission's `statement_id` becomes `AllowEventBridgeInvoke`. `s3:PutObjectAcl` is dropped: the code never sets an ACL, and the bucket has ACLs disabled.

Because the names stay the same, the CloudFormation stack must be fully deleted before OpenTofu creates the new resources. SQS also blocks reusing a deleted queue's name for about 60 seconds.

Mapping CDK resources to OpenTofu resources:
- Role → `aws_iam_role` + 2× `aws_iam_role_policy` + `aws_iam_role_policy_attachment` (BasicExecutionRole). Uses neither the deprecated `managed_policy_arns` nor `inline_policy`.
- Rule → `aws_cloudwatch_event_rule` + `aws_cloudwatch_event_target`.
- Lambda → `aws_lambda_function` with `dead_letter_config`, `depends_on` the policies and the log group.

### D6. Bundle with esbuild in the backend build, zip with `archive_file`
`backend` `build` becomes `tsc --noEmit && esbuild src/handlers/newJerseySheriffSaleScraperHandler.ts --bundle --platform=node --target=node24 --format=cjs --outfile=dist/index.js` (wrapped in a script or npm script; the root workspace already has `esbuild`). `@aws-sdk/*` is bundled rather than taken from the runtime, so the pinned `3.379.1` client is what runs. `infra/` uses `data "archive_file"` over `backend/dist`, and sets `source_code_hash` from it.
- *Alternative, use the runtime's bundled SDK:* the zip would be smaller, but the SDK version would change silently with runtime patches.
- `AWS_NODEJS_CONNECTION_REUSE_ENABLED` is dropped. It only affected SDK v2, and v3 reuses connections by default.
- The handler is already `async` with no callback, so it is compatible with `nodejs24.x`, which no longer supports callback-style handlers.

### D7. Inputs and secrets
`variable "database_url" { sensitive = true }` is supplied as `TF_VAR_database_url`. Locally it is set in `mise.local.toml` or the shell; in CI it comes from the `DATABASE_URL` secret. `ENV` is set from `local.env`. The value ends up in state, as it does in the CloudFormation template today.

### D8. CI: build anywhere, apply only on main
- `build` (all branches): also uploads `backend/dist` as an artifact. The placeholder env stays, since the build no longer needs AWS access.
- `deploy-backend` (main, `dev` environment, needs `migrate`): downloads the artifact, installs OpenTofu (`opentofu/setup-opentofu`, version matching `mise.toml`), then runs `tofu init` and `tofu apply -auto-approve` in `infra/`.
- It is removed from the workflow before cutover, and only added back after cutover is verified (D9 step 9).

### D9. Layout
```
infra/
  versions.tf    required_version >= 1.10; aws ~> 6, archive ~> 2
  backend.tf     s3 backend (added at bootstrap step 3)
  providers.tf   aws { region = "us-east-2", allowed_account_ids = ["590184139982"] }
  locals.tf      env, state_bucket, name prefixes
  variables.tf   database_url
  state.tf       tofu state bucket
  storage.tf     nj-sheriff-sale-<env> + SSE
  scraper.tf     lambda, iam, dlq, rule, target, permission, log group
  imports.tf     import blocks (bucket, SSE, log group); removed after cutover
  .gitignore     .terraform/, *.tfstate*, crash logs
```

## Risks / Trade-offs

- [Deleting the stack before the bucket is retained deletes the scraper resources and leaves the bucket's protection to luck] → D2 runs before any deletion. Confirm with `aws cloudformation get-template` that the bucket shows `Retain` before step 6.
- [A CDK deploy runs mid-cutover and recreates resources] → Remove `deploy-backend` from CI first (step 1). CDK synth is also already broken.
- [Name collision with a half-deleted stack, or the SQS 60-second name cooldown] → Wait for `DELETE_COMPLETE`, wait ≥ 60 seconds, then apply. Rerunning `tofu apply` is safe.
- [IAM eventual consistency: Lambda create fails with "role cannot be assumed"] → The provider retries this. Rerun the apply if it still fails.
- [Node 24 behavior differences in dependencies] → Run `npm run start:newJerseyScraper` locally on Node 24 before cutover, and invoke the function manually right after.
- [The scraper misses a daily run] → Cut over just after 00:00 UTC. Missing one run is acceptable, and a manual invoke can make it up.
- [Bucket import shows unexpected drift] → Check the import (step 5) while CloudFormation still exists, before anything is deleted. If the plan shows changes to the bucket, stop and fix the HCL.
- [A config that manages its own state bucket can lock itself out] → Versioning plus `prevent_destroy`. The bootstrap is documented in `infra/README.md`.
- [`DATABASE_URL` in plaintext state] → Private, encrypted, versioned bucket, and access is limited to account principals. Same exposure as the CloudFormation template today.

## Migration Plan

Run manually from a developer machine with `AWS_PROFILE=sheriff-sale` (from `mise.local.toml`) and `TF_VAR_database_url` set.

1. **Freeze CDK:** merge a CI change that removes `deploy-backend`.
2. **Bootstrap state:** run D4 steps 1–4. `tofu plan -target` for the state bucket shows no changes.
3. **Pre-flight:** record the bucket's object count (`aws s3 ls --summarize --recursive`). Build the Node 24 bundle and smoke-test it locally.
4. **Retain the bucket:** update the stack as in D2. Verify the deployed template shows `Retain` on the bucket.
5. **Import the bucket and log group:** `tofu apply -target` for the bucket, its SSE config, and the log group. Then `tofu plan -target` on the same resources shows no changes.
6. **Delete the stack:** `aws cloudformation delete-stack --stack-name SheriffSaleStack`, then wait for `DELETE_COMPLETE`. Confirm the bucket and its object count are unchanged.
7. **Create the rest:** wait ≥ 60 seconds, then `tofu apply` (full).
8. **Verify:** `aws lambda invoke` succeeds, new objects appear under today's date, and a full `tofu plan` shows no changes. Check the next 00:00 UTC run in the logs.
9. **Hand over to CI:** add the OpenTofu `deploy-backend` job and the bundle artifact. Remove `imports.tf`, CDK files, dependencies, turbo entries, and README references. The first CI run on `main` applies with no changes.
10. **Remove CDKToolkit:** empty the assets bucket (including old versions) and the ECR repo, then delete the `CDKToolkit` stack, and delete any retained bootstrap bucket by hand.

**Rollback:**
- Before step 6: remove the bucket and log group from state (`tofu state rm`). CloudFormation still owns everything, and the bucket's `Retain` is harmless.
- After step 6: the bucket is safe under OpenTofu. The scraper can be recreated by fixing the HCL and re-applying. Going back to CDK is not planned, since its deploy is already broken.

## Open Questions

- None blocking. The exact AWS block-create date for `nodejs20.x` is unconfirmed (Aug 2026 vs Feb 2027), but it doesn't matter because the rebuild uses `nodejs24.x`.
