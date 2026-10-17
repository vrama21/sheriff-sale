## 1. Freeze CDK deploys

- [ ] 1.1 Remove the `deploy-backend` job from `.github/workflows/cicd.yml` (keep `build`, `migrate`, `deploy-frontend`)
- [ ] 1.2 Merge to `main` and confirm the `main` run has no CDK deploy step

## 2. Tooling and Lambda bundle

- [ ] 2.1 Add `opentofu = "1.10"` under `[tools]` in `mise.toml` and verify `tofu version` via mise
- [ ] 2.2 Replace the `backend` `build` script with `tsc --noEmit` plus an esbuild bundle of `src/handlers/newJerseySheriffSaleScraperHandler.ts` to `dist/index.js` (`--bundle --platform=node --target=node24 --format=cjs`, `@aws-sdk/*` bundled)
- [ ] 2.3 Remove `cdk synth` from the build and confirm `npm run build` succeeds with placeholder `DATABASE_URL`/`ENV` and no AWS credentials
- [ ] 2.4 Verify `require('./backend/dist/index.js').handler` is a function under Node 24
- [ ] 2.5 Smoke-test the scraper locally on Node 24 (`npm run start:newJerseyScraper`)

## 3. OpenTofu config

- [ ] 3.1 Create `infra/` with `versions.tf` (`required_version >= 1.10`, aws `~> 6`, archive `~> 2`), `providers.tf` (us-east-2, `allowed_account_ids = ["590184139982"]`), `locals.tf` (`env = "dev"`, `state_bucket = "sheriff-sale-tofu-state-590184139982"`), `variables.tf` (`database_url`, sensitive), and `.gitignore`
- [ ] 3.2 Write `state.tf`: state bucket with versioning, Block Public Access, AES256 SSE, and `prevent_destroy`
- [ ] 3.3 Write `storage.tf`: `nj-sheriff-sale-${local.env}` bucket with `prevent_destroy` and its AES256 SSE configuration
- [ ] 3.4 Write `scraper.tf`: log group, DLQ (14-day retention, SQS-managed SSE), IAM role + `s3-archive-access` and `dlq-send` inline policies + BasicExecutionRole attachment, `archive_file` over `backend/dist`, Lambda (`nodejs24.x`, `index.handler`, 512 MB, 900 s, DLQ, env `DATABASE_URL`/`ENV`), EventBridge rule `cron(0 0 * * ? *)` + target, and `AllowEventBridgeInvoke` permission
- [ ] 3.5 Write `imports.tf` with import blocks for the archive bucket, its SSE config, and the log group
- [ ] 3.6 Write `infra/README.md` documenting the bootstrap, `TF_VAR_database_url`, and the day-to-day plan/apply flow
- [ ] 3.7 `tofu fmt -check` and `tofu validate` pass

## 4. Bootstrap state

- [ ] 4.1 With no backend block, `tofu init` and `tofu apply -target` the state bucket and its versioning/PAB/SSE resources
- [ ] 4.2 Add `backend.tf` (`s3`, `bucket = local.state_bucket`, `key = "sheriff-sale.tfstate"`, `use_lockfile = true`) and run `tofu init -migrate-state`
- [ ] 4.3 Delete local `terraform.tfstate*` files, then confirm the state object exists in S3 and a targeted plan of the state bucket shows no changes

## 5. Cutover (manual, just after 00:00 UTC)

- [ ] 5.1 Record `nj-sheriff-sale-dev` object count and total size
- [ ] 5.2 Export the deployed template, set `DeletionPolicy`/`UpdateReplacePolicy` to `Retain` on `NewJerseySheriffSaleBucketA75A18D1` only (add a `Metadata` key if CloudFormation rejects a policy-only update), preview with a change set, and run it
- [ ] 5.3 Verify with `get-template` that the bucket shows `Retain`
- [ ] 5.4 `tofu apply -target` the archive bucket, its SSE config, and the log group (imports), then confirm a targeted plan shows no changes
- [ ] 5.5 `aws cloudformation delete-stack --stack-name SheriffSaleStack`, wait for `DELETE_COMPLETE`, and confirm the bucket and its object count are unchanged
- [ ] 5.6 Wait ≥ 60 seconds, then run a full `tofu apply`
- [ ] 5.7 `aws lambda invoke` the function and confirm success and new objects under today's date
- [ ] 5.8 Confirm a full `tofu plan` shows no changes
- [ ] 5.9 Confirm the next scheduled 00:00 UTC run appears in `/aws/lambda/new-jersey-sheriff-sale-scraper-dev`

## 6. Hand over to CI

- [ ] 6.1 Upload `backend/dist` as an artifact from the `build` job
- [ ] 6.2 Add a `deploy-backend` job (main only, `dev` environment, `needs: migrate`) that downloads the bundle, installs OpenTofu with `opentofu/setup-opentofu` matching `mise.toml`, and runs `tofu init` + `tofu apply -auto-approve` in `infra/` with `TF_VAR_database_url` and the AWS secrets
- [ ] 6.3 Delete `infra/imports.tf`
- [ ] 6.4 Merge and confirm the first `main` run applies with no changes

## 7. Remove CDK

- [ ] 7.1 Delete `backend/bin/`, `backend/lib/`, `backend/cdk.json`, and `packages/tsconfig/awscdk.json` (point `backend/tsconfig.json` at a non-CDK base such as `node20.json` or a new `node24` preset)
- [ ] 7.2 Remove `aws-cdk`, `aws-cdk-lib`, `constructs`, and unused `source-map-support` from `backend/package.json`, the `deploy`/`cdk` scripts, and `cdk.out` from `backend` `clean`; update the lockfile
- [ ] 7.3 Remove `cdk.out/**` outputs and `CDK_DEFAULT_*` env from `turbo.json`, and `backend/cdk.out` from `.gitignore`
- [ ] 7.4 Rewrite `backend/README.md` and update the root `README.md` (backend description, `npm run deploy` row) to describe the OpenTofu flow
- [ ] 7.5 Confirm no `aws-cdk`/`cdk.out` references remain outside `node_modules`, lockfiles, and `openspec/`
- [ ] 7.6 Empty the CDK assets bucket (all versions) and ECR repo, delete the `CDKToolkit` stack, and remove any retained bootstrap resources
- [ ] 7.7 Confirm `list-stacks` shows neither `SheriffSaleStack` nor `CDKToolkit`
