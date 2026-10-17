## 1. Freeze CDK deploys

- [x] 1.1 Remove the `deploy-backend` job from `.github/workflows/cicd.yml` (keep `build`, `migrate`, `deploy-frontend`)
- [x] 1.2 Merge to `main` and confirm the `main` run has no CDK deploy step

## 2. Tooling and Lambda bundle

- [x] 2.1 Add `opentofu = "1.13"` under `[tools]` in `mise.toml` and verify `tofu version` via mise
- [x] 2.2 Replace the `backend` `build` script with `tsc --noEmit` plus an esbuild bundle of `src/handlers/newJerseySheriffSaleScraperHandler.ts` to `dist/index.js` (`--bundle --platform=node --target=node24 --format=cjs`, `@aws-sdk/*` bundled)
- [x] 2.3 Remove `cdk synth` from the build and confirm `npm run build` succeeds with placeholder `DATABASE_URL`/`ENV` and no AWS credentials
- [x] 2.4 Verify `require('./backend/dist/index.js').handler` is a function under Node 24
- [ ] 2.5 Smoke-test the scraper locally on Node 24 (`npm run start:newJerseyScraper`). Optional: it writes to the prod bucket and database, and 6.7 invokes the deployed function anyway.

## 3. OpenTofu config

- [x] 3.1 Create `infra/` with `versions.tf` (`required_version >= 1.10`, aws `~> 6`, archive `~> 2`), `providers.tf` (us-east-2, `allowed_account_ids = ["590184139982"]`), `locals.tf` (`env`, `state_bucket = "sheriff-sale-tofu-state-590184139982"`), `variables.tf` (`database_url`, sensitive), and `.gitignore`. Written with `env = "dev"`; switched to `prod` in 5.1.
- [x] 3.2 Write `state.tf`: state bucket with versioning, Block Public Access, AES256 SSE, and `prevent_destroy`
- [x] 3.3 Write `storage.tf`: archive bucket with `prevent_destroy` and its AES256 SSE configuration. Written as `nj-sheriff-sale-${local.env}`; renamed in 5.1.
- [x] 3.4 Write `scraper.tf`: log group, DLQ (14-day retention, SQS-managed SSE), IAM role + `s3-archive-access` and `dlq-send` inline policies + BasicExecutionRole attachment, `archive_file` over `backend/dist`, Lambda (`nodejs24.x`, `index.handler`, 512 MB, 900 s, DLQ, env `DATABASE_URL`/`ENV`), EventBridge rule `cron(0 0 * * ? *)` + target, and `AllowEventBridgeInvoke` permission
- [x] 3.5 Write `imports.tf` with import blocks for the archive bucket, its SSE config, and the log group. Superseded: deleted in 5.1.
- [x] 3.6 Write `infra/README.md` documenting the bootstrap, `TF_VAR_database_url`, and the day-to-day plan/apply flow
- [x] 3.7 `tofu fmt -check` and `tofu validate` pass

## 4. Bootstrap state

- [x] 4.1 With no backend block, `tofu init` and `tofu apply -target` the state bucket and its versioning/PAB/SSE resources
- [x] 4.2 Add `backend.tf` (`s3`, `bucket = local.state_bucket`, `key = "sheriff-sale.tfstate"`, `use_lockfile = true`) and run `tofu init -migrate-state`
- [x] 4.3 Delete local `terraform.tfstate*` files, then confirm the state object exists in S3 and a targeted plan of the state bucket shows no changes

## 5. Prepare the old stack and the prod config

- [x] 5.0a Record `nj-sheriff-sale-dev` object count and total size (47,498 objects, 1,249,289,548 bytes)
- [x] 5.0b Export the deployed template, set `DeletionPolicy`/`UpdateReplacePolicy` to `Retain` on `NewJerseySheriffSaleBucketA75A18D1` only, preview with a change set, and run it
- [x] 5.0c Verify with `get-template` that the bucket shows `Retain`
- [x] 5.0d `tofu apply -target` imports of `nj-sheriff-sale-dev`, its SSE config, and the `-dev` log group. Superseded by the rename: undone in 5.3.
- [x] 5.1 Set `local.env = "prod"`, name the archive bucket `nj-sheriff-sale` (not env-derived), and delete `infra/imports.tf`
- [x] 5.2 Change `saveHtmlToS3.ts` to write to the constant `nj-sheriff-sale` and drop its `ENV` check; rebuild the bundle
- [x] 5.3 `tofu state rm` `aws_s3_bucket.archive`, `aws_s3_bucket_server_side_encryption_configuration.archive`, and `aws_cloudwatch_log_group.scraper` (the `-dev` imports), and confirm the real resources still exist
- [x] 5.4 `tofu plan` shows only creates (archive bucket, SSE, scraper resources), with no imports, updates, or destroys
- [x] 5.5 Update `infra/README.md` for the `prod` names

## 6. Cutover (manual, between daily runs)

- [x] 6.1 Confirm `TF_VAR_database_url` is set
- [x] 6.2 `aws cloudformation delete-stack --stack-name SheriffSaleStack`, wait for `DELETE_COMPLETE`, and confirm `nj-sheriff-sale-dev` still matches the 5.0a baseline
- [x] 6.3 `tofu apply -target` `aws_s3_bucket.archive` and its SSE config to create `nj-sheriff-sale`
- [x] 6.4 `aws s3 sync s3://nj-sheriff-sale-dev s3://nj-sheriff-sale`
- [x] 6.5 Verify `nj-sheriff-sale` object count and total size match the baseline, and a repeat `aws s3 sync --dryrun` lists nothing
- [x] 6.6 Full `tofu apply` to create the scraper resources (first created with `-prod` names; renamed in 6.10)
- [x] 6.7 `aws lambda invoke` `new-jersey-sheriff-sale-scraper` and confirm success and new objects under today's date in `nj-sheriff-sale`
- [x] 6.8 Confirm a full `tofu plan` shows no changes
- [ ] 6.9 Confirm the next scheduled 00:00 UTC run appears in `/aws/lambda/new-jersey-sheriff-sale-scraper`
- [x] 6.10 Drop the `-prod` suffix from all scraper resource names (`local.scraper_name`), wait for the in-flight 6.7 invoke to finish, then apply the replacement (10 replaced, buckets untouched) and confirm a clean plan

## 7. Hand over to CI

- [x] 7.1 Create the `prod` GitHub environment and set variable `ENV=prod`
- [ ] 7.2 (User) Set the `prod` secrets: `DATABASE_URL`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN` (no AWS keys; see 7.8)
- [x] 7.3 Upload `backend/dist` as an artifact from the `build` job
- [x] 7.4 Add a `deploy-backend` job (main only, `needs: migrate`) that downloads the bundle, installs OpenTofu from `mise.toml` with `jdx/mise-action`, and runs `tofu init` + `tofu apply -auto-approve` in `infra/` with `TF_VAR_database_url` and the AWS secrets
- [x] 7.5 Switch `migrate`, `deploy-backend`, and `deploy-frontend` to `environment: prod`
- [ ] 7.6 Merge and confirm the first `main` run's `migrate` and `deploy-backend` succeed (apply shows no changes)
- [ ] 7.7 Delete the `dev` GitHub environment
- [x] 7.8 Add `infra/github-actions.tf` (GitHub OIDC provider, `sheriff-sale-github-actions` role trusting only `repo:vrama21/sheriff-sale:environment:prod`, scoped `tofu-apply` policy) and apply it locally
- [x] 7.9 Switch `deploy-backend` to OIDC (`id-token: write`, `aws-actions/configure-aws-credentials@v6`) and drop the AWS key env vars
- [x] 7.10 Verify from a temporary `cicd-oidc-check` branch that CI assumes the role and a full `tofu plan` refreshes with no access errors; delete the branch
- [ ] 7.11 After 7.6 passes: deactivate, then delete, both `cicd-pipeline-deployer` access keys and the user; delete the repo-level `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID`, `AWS_DEFAULT_REGION` secrets

## 8. Remove CDK and dev leftovers

- [ ] 8.1 Delete `backend/bin/`, `backend/lib/`, `backend/cdk.json`, and `packages/tsconfig/awscdk.json` (point `backend/tsconfig.json` at a non-CDK base such as `node20.json` or a new `node24` preset)
- [ ] 8.2 Remove `aws-cdk`, `aws-cdk-lib`, `constructs`, and unused `source-map-support` from `backend/package.json`, the `deploy`/`cdk` scripts, and `cdk.out` from `backend` `clean`; update the lockfile
- [ ] 8.3 Remove `cdk.out/**` outputs and `CDK_DEFAULT_*` env from `turbo.json`, and `backend/cdk.out` from `.gitignore`
- [ ] 8.4 Rewrite `backend/README.md` and update the root `README.md` (backend description, `npm run deploy` row) to describe the OpenTofu flow
- [ ] 8.5 Confirm no `aws-cdk`/`cdk.out` references remain outside `node_modules`, lockfiles, and `openspec/`
- [ ] 8.6 Empty the CDK assets bucket (all versions) and ECR repo, delete the `CDKToolkit` stack, and remove any retained bootstrap resources
- [ ] 8.7 Confirm `list-stacks` shows neither `SheriffSaleStack` nor `CDKToolkit`
- [ ] 8.8 After the grace period (default: one week after 6.5 and at least one successful scheduled run), empty and delete `nj-sheriff-sale-dev` and delete `/aws/lambda/new-jersey-sheriff-sale-scraper-dev`
