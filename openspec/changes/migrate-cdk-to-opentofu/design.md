## Context

The backend runs as one CloudFormation stack, `SheriffSaleStack` (account 590184139982, us-east-2), synthesized from the CDK app in `backend/bin` and `backend/lib`. A live read on 2026-10-16 showed:

| CFN logical ID | Type | Physical ID | Fate |
|---|---|---|---|
| `NewJerseySheriffSaleBucketA75A18D1` | S3 bucket | `nj-sheriff-sale-dev` (47,498 objects, 1,249,289,548 bytes) | **Retain**, copy into `nj-sheriff-sale`, delete after grace period |
| `NewJerseySheriffSaleScraper80654AD5` | Lambda | `new-jersey-sheriff-sale-scraper-dev` (nodejs20.x) | delete, recreate with an env-less name |
| `NewJerseySheriffSaleScraperRoleD78E4208` | IAM role (+ inline `NewJerseySheriffSaleScraperPolicy`) | `new-jersey-sheriff-sale-scraper-role-dev` | delete, recreate with an env-less name |
| `NewJerseySheriffSaleScraperRoleDefaultPolicy05FC6E9E` | IAM policy (inline on role) | `sqs:SendMessage` on DLQ | delete, recreate under a readable name |
| `NewJerseySheriffSaleScraperDLQEEECC262` | SQS | `new-jersey-sheriff-sale-scraper-dlq-dev` (0 messages) | delete, recreate with an env-less name |
| `NewJerseySheriffSaleScraperRule058BA2B7` | EventBridge rule | `new-jersey-sheriff-sale-scraper-rule-dev`, `cron(0 0 * * ? *)` | delete, recreate with an env-less name |
| `…RuleAllowEventRule…3A8ABCD33B5A41E9` | Lambda permission | generated statement ID | delete, recreate |
| `CDKMetadata` | CDK metadata | none | drop |

Outside the stack:
- Log group `/aws/lambda/new-jersey-sheriff-sale-scraper-dev`: created by Lambda, never expires, 57 MB.
- `CDKToolkit` bootstrap stack (v20): its assets bucket holds the current Lambda zip.

The `-dev` names are a leftover from CDK. AWS hosts exactly one deployed environment, which from now on is `prod`. All testing is local.

CI's `deploy-backend` job fails in CDK synth today. `main` is the only branch that deploys, through the GitHub environment `dev` (secrets plus `ENV=dev`), with long-lived AWS keys.

**Progress when this design was revised:**
- The state bucket is bootstrapped.
- `nj-sheriff-sale-dev` is `Retain` in CloudFormation.
- `nj-sheriff-sale-dev`, its SSE config, and the `-dev` log group were imported into OpenTofu state under the earlier `-dev` plan. They have to come out of state again (D3).

## Goals / Non-Goals

**Goals:**
- One OpenTofu root config (`infra/`) owns all backend AWS resources for the single `prod` environment, plus its own state bucket.
- The full scrape archive ends up in `nj-sheriff-sale`, a bucket with no env in its name. Nothing is lost.
- The scraper keeps its daily schedule under readable env-less names, moving to `nodejs24.x`.
- CI deploys from a `prod` GitHub environment. The CDK toolchain, CDK stacks, and `-dev` leftovers are removed.

**Non-Goals:**
- Keeping the `nj-sheriff-sale-dev` bucket itself. Only its data is kept.
- Multiple environments, workspaces, or modules. `env` is a single local set to `"prod"`, used only as the Lambda's `ENV` value; resource names carry no env.
- Isolating local runs. Local scraper runs write to `nj-sheriff-sale` and the hosted Railway database, just as local runs already use that database today. This is left for a later change.
- Plans on PRs or feature branches, or GitHub OIDC in place of access keys.
- Moving `DATABASE_URL` to SSM or Secrets Manager.
- Fixing the handler's `Promise.allSettled` error swallowing. Today it means the DLQ never receives anything; this is noted for a follow-up change.
- Managing the archive bucket's Block Public Access and ownership controls. They stay AWS defaults on the new bucket, not declared. The same goes for a log retention policy.

## Decisions

### D1. Keep the data, not the bucket: copy into `nj-sheriff-sale`
S3 buckets can't be renamed, so the archive moves into a new bucket, `nj-sheriff-sale`, created by OpenTofu. Its name has no env, so it never needs renaming again; `HeadBucket` returned 404, so the name was free. The data is copied with `aws s3 sync s3://nj-sheriff-sale-dev s3://nj-sheriff-sale`, which copies object to object inside S3. Roughly 47k COPY requests cost about $0.25, and in-region transfer is free.
- The sync runs *after* `SheriffSaleStack` is deleted, so the old Lambda can't add objects during or after the copy.
- Copied objects get a new `LastModified`. That doesn't matter: keys already carry the scrape date (`<prefix>/<YYYY-MM-DD>/<suffix>`), and nothing reads `LastModified`.
- To verify, the object count and total bytes must match, and a second `aws s3 sync --dryrun` must list nothing to copy.
- `nj-sheriff-sale-dev` stays as a fallback for a grace period, then it is emptied and deleted (tasks group 7).
- Everything else in the stack is stateless config and is recreated, not imported.
- *Alternative, keep the `nj-sheriff-sale-dev` name:* no copy needed, but the single `prod` environment would keep a permanent `dev` name.
- *Alternative, `nj-sheriff-sale-prod`:* still tied to an environment, which goes against the single-environment model.

### D2. Release the old bucket from CloudFormation by changing its policy to Retain (done)
Ran a direct `update-stack` through a change set with the deployed template, editing only `DeletionPolicy` and `UpdateReplacePolicy` to `Retain` on `NewJerseySheriffSaleBucketA75A18D1`. CloudFormation listed four dependent resources as `Dynamic` changes, because they reference the bucket ARN through `GetAtt`. None of them were actually updated. When the stack is deleted, CloudFormation removes everything except `nj-sheriff-sale-dev`, which is then left unmanaged until it is deleted.

### D3. Undo the `-dev` imports and drop `imports.tf`
Under the earlier plan, `nj-sheriff-sale-dev`, its SSE config, and `/aws/lambda/new-jersey-sheriff-sale-scraper-dev` were imported into state at `aws_s3_bucket.archive`, `aws_s3_bucket_server_side_encryption_configuration.archive`, and `aws_cloudwatch_log_group.scraper`. With the names changed, a plan would try to replace them, and `prevent_destroy` would block that. They are removed from state with `tofu state rm`, which leaves the real resources alone, *before* the config with the new names is planned. `infra/imports.tf` is deleted. No resource is imported in the final design: `nj-sheriff-sale`, the scraper's log group, and the scraper are all created.
- *Alternative, `removed` blocks:* these record in the config that the resources were dropped. For a one-time cleanup during a manual cutover, the CLI is simpler and leaves nothing behind in the config.

### D4. The state bucket lives in the same root config, bootstrapped from local state (done)
The state bucket (`sheriff-sale-tofu-state-590184139982`) is an `aws_s3_bucket` in `infra/state.tf`, with versioning, Block Public Access, AES256 default encryption, and `prevent_destroy`. Bootstrap steps:
1. Start with no `backend` block, so state is local.
2. `tofu apply -target` the state bucket resources.
3. Add `backend "s3" { bucket = local.state_bucket, key = "sheriff-sale.tfstate", region = local.region, use_lockfile = true }`.
4. `tofu init -migrate-state`, then delete the local state files.

OpenTofu ≥ 1.8 can evaluate locals in the backend block. `use_lockfile` (OpenTofu ≥ 1.10) locks with a file in S3, so no DynamoDB table is needed. The state bucket name has no env and is not affected by the rename.
- *Alternative, a separate bootstrap root config:* rejected, since the decision is one root config.
- *Alternative, OpenTofu client-side state encryption:* rejected for now. Anyone who can read the state bucket already has account access and can read `DATABASE_URL` from the Lambda.

### D5. Readable env-less names, generated names dropped
Function, role, queue, rule, and log group become `new-jersey-sheriff-sale-scraper`, `…-role`, `…-dlq`, `…-rule`, and `/aws/lambda/new-jersey-sheriff-sale-scraper`. The two inline policies get readable names, `s3-archive-access` and `dlq-send`. The permission's `statement_id` is `AllowEventBridgeInvoke`. `s3:PutObjectAcl` is dropped: the code never sets an ACL, and the bucket has ACLs disabled.

The new names don't overlap with the old stack's, so creating them doesn't depend on the stack being deleted first, and there is no SQS same-name cooldown. The order in D10 deletes the stack first anyway, because of the archive copy (D1). The log group is created by OpenTofu, and the function `depends_on` it, so Lambda never creates it outside OpenTofu.

Mapping CDK resources to OpenTofu resources:
- Role → `aws_iam_role` + 2× `aws_iam_role_policy` + `aws_iam_role_policy_attachment` (BasicExecutionRole).
- Rule → `aws_cloudwatch_event_rule` + `aws_cloudwatch_event_target`.
- Lambda → `aws_lambda_function` with `dead_letter_config`, `depends_on` the policies and the log group.

### D6. Bundle with esbuild in the backend build, zip with `archive_file` (done)
`backend` `build` is `tsc --noEmit && npm run bundle`. `bundle` runs esbuild on the handler with `--bundle --platform=node --target=node24 --format=cjs --outfile=dist/index.js`. `@aws-sdk/*` is bundled, so the pinned `3.379.1` client runs. `infra/` uses `data "archive_file"` (`output_file_mode = "0644"`) over `backend/dist/index.js`, and sets `source_code_hash` from it. `AWS_NODEJS_CONNECTION_REUSE_ENABLED` is dropped, since it only affected SDK v2. The handler is `async` with no callback, which `nodejs24.x` requires.

### D7. Inputs, secrets, and the fixed bucket name
- `variable "database_url" { sensitive = true }` is supplied as `TF_VAR_database_url`. Locally it is set in `mise.local.toml` or the shell; in CI it comes from the `prod` environment's `DATABASE_URL` secret. The value ends up in state, as it does in the CloudFormation template today.
- `ENV` is set from `local.env` (`prod`). The code no longer uses it to build the bucket name, but it stays in the Lambda environment.
- `saveHtmlToS3.ts` replaces `` `nj-sheriff-sale-${ENV}` `` with the constant `nj-sheriff-sale` and drops its `ENV` check. A bucket-name env var was considered and deferred, together with isolating local runs.

### D8. CI: build anywhere, apply only on main, in `prod`
- `build` (all branches): also uploads `backend/dist` as an artifact. The placeholder env stays, since the build no longer needs AWS access.
- `migrate`, `deploy-backend`, and `deploy-frontend` (main only) use `environment: prod`.
- `deploy-backend` (`needs: migrate`): downloads the artifact, installs OpenTofu with `jdx/mise-action`, which installs the version pinned in `mise.toml` so CI and local runs match, then runs `tofu init` and `tofu apply -auto-approve` in `infra/` with `TF_VAR_database_url` and the AWS secrets.
- Workflow concurrency still cancels superseded runs on other branches, but never on `main`. Cancelling a `tofu apply` partway could leave infrastructure half-applied and the state lock held.

### D9. GitHub environment `dev` → `prod`
The repo has a `dev` environment with 6 secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`) and the variable `ENV=dev`. GitHub's API can't read secret values, so they can't be copied:
1. Create the `prod` environment and set `ENV=prod`. This can be done with `gh`.
2. The user re-enters the 6 secrets, e.g. `gh secret set <NAME> --env prod`.
3. Switch the workflow to `environment: prod`.
4. Delete `dev` once a `main` run succeeds.

The repo also has a `Preview` environment, probably created by Vercel. It is left alone.

### D10. Layout
```
infra/
  versions.tf    required_version >= 1.10; aws ~> 6, archive ~> 2
  backend.tf     s3 backend
  providers.tf   aws { region, allowed_account_ids = ["590184139982"] }
  locals.tf      env = "prod" (ENV value only), state_bucket, scraper_name
  variables.tf   database_url
  state.tf       tofu state bucket
  storage.tf     nj-sheriff-sale + SSE
  scraper.tf     log group, lambda, iam, dlq, rule, target, permission
  .gitignore     .terraform/, *.tfstate*, crash logs, .build/
```

## Risks / Trade-offs

- [The copy misses objects] → Compare object counts and total bytes, and require a second `sync --dryrun` to list nothing. Keep `nj-sheriff-sale-dev` through the grace period.
- [The old Lambda writes to `nj-sheriff-sale-dev` after the copy] → Copy only after `SheriffSaleStack` is `DELETE_COMPLETE`.
- [Planning with the new names before the `-dev` resources are out of state] → `prevent_destroy` makes that plan fail rather than replace anything. Run `tofu state rm` first (task order).
- [A CDK deploy runs mid-cutover] → `deploy-backend` was removed from CI first, and CDK synth is broken anyway.
- [IAM eventual consistency: Lambda create fails with "role cannot be assumed"] → The provider retries this. Rerun the apply if it still fails.
- [Node 24 behavior differences in dependencies] → Invoke the function manually right after the apply, and check the next scheduled run.
- [The scraper misses a daily run] → Cut over between runs. A manual invoke makes up for it.
- [Secrets mistyped while moving to the `prod` GitHub environment] → The first `main` run after the switch exercises every secret (migrate, apply, Vercel). Keep `dev` until that run passes.
- [Local runs write to the prod bucket and database] → Accepted for now, as it already happens with the database. Isolating local runs is a follow-up.
- [`DATABASE_URL` in plaintext state] → Private, encrypted, versioned bucket, and access is limited to account principals.

## Migration Plan

Run manually from a developer machine with `AWS_PROFILE=sheriff-sale` and `TF_VAR_database_url` set.

1. **Freeze CDK** (done): remove `deploy-backend` from CI.
2. **Bootstrap state** (done): D4.
3. **Baseline** (done): `nj-sheriff-sale-dev` has 47,498 objects and 1,249,289,548 bytes.
4. **Retain the old bucket** (done): D2.
5. **Repoint the code:**
   - `local.env = "prod"`.
   - The archive bucket becomes `nj-sheriff-sale`.
   - `saveHtmlToS3.ts` uses the fixed name.
   - Delete `imports.tf`.
   - Rebuild the bundle.
6. **Clean up state:** `tofu state rm` the three `-dev` addresses (D3).
7. **Delete the stack:** `aws cloudformation delete-stack --stack-name SheriffSaleStack`, then wait for `DELETE_COMPLETE`. Confirm `nj-sheriff-sale-dev` still matches the baseline.
8. **Create and fill the archive:** `tofu apply -target` `nj-sheriff-sale` and its SSE config. Then `aws s3 sync s3://nj-sheriff-sale-dev s3://nj-sheriff-sale`, and verify as in D1.
9. **Create the rest:** full `tofu apply`.
10. **Verify:**
    - `aws lambda invoke` the scraper function, and check for new objects under today's date in `nj-sheriff-sale`.
    - A full `tofu plan` shows no changes.
    - The next 00:00 UTC run appears in the scraper's log group.
11. **Hand over to CI:**
    - Set up the `prod` GitHub environment (D9).
    - Add the OpenTofu `deploy-backend` job and the bundle artifact.
    - Switch jobs to `environment: prod`.
    - The first `main` run applies with no changes.
    - Delete the `dev` environment.
12. **Clean up:**
    - Remove the CDK files and dependencies.
    - Empty and delete `CDKToolkit`.
    - After the grace period, empty and delete `nj-sheriff-sale-dev` and delete the `-dev` log group.

**Rollback:**
- Before step 7: CloudFormation still owns the scraper, and the `-dev` bucket's `Retain` is harmless. Restore the `-dev` config and state, or simply don't continue.
- After step 7: `nj-sheriff-sale-dev` is the safe copy until the grace period ends. The scraper can be recreated by fixing the HCL and re-applying. Going back to CDK is not planned.

## Open Questions

- How long the grace period should be before `nj-sheriff-sale-dev` is deleted. The default proposal is one week after a verified copy and at least one successful scheduled run.
