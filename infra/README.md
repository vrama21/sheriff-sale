# infra

OpenTofu config for the backend's AWS resources (account `590184139982`, `us-east-2`). AWS hosts a
single environment; all testing is local.

- `nj-sheriff-sale`: S3 archive of scraped pages (`prevent_destroy`, Block Public Access,
  versioned; noncurrent versions expire after 30 days)
- `new-jersey-sheriff-sale-scraper`: scraper Lambda, its IAM role, SQS dead-letter queue, log
  group (90-day retention), and the daily `cron(0 0 * * ? *)` EventBridge schedule. Failed async
  runs are not retried; they go straight to the dead-letter queue.
- `new-jersey-sheriff-sale-scraper-alarms`: SNS topic with an email subscription to `alert_email`, notified when one
  of the scraper's alarms enters `ALARM`:
  - `-errors`: the function errored at least once in a day (the handler throws when any county fails)
  - `-dlq`: a message is in the dead-letter queue; it stays in `ALARM` until the queue is purged
  - `-no-runs`: the function wasn't invoked for a day
- `new-jersey-clerk-records`: clerk records Lambda and its log group (the scraper's retention), invoked daily at
  `cron(0 2 * * ? *)`. It runs as the scraper's role, shares its dead-letter queue, and archives result pages to
  `nj-sheriff-sale` under `clerk-records/`. It has no alarms yet.
- `sheriff-sale-tofu-state-590184139982`: the bucket holding this config's own state
  (`prevent_destroy`, versioned)

Resource names carry no environment.

## Prerequisites

- OpenTofu, pinned in the root `mise.toml` (`mise install`).
- AWS credentials for the account, e.g. `AWS_PROFILE` in `mise.local.toml`.
- `TF_VAR_database_url` set to the prod `DATABASE_URL` (e.g. in `mise.local.toml`).
- `TF_VAR_alert_email` set to the address the alarms email. CI reads it from the `ALERT_EMAIL` repository variable
  (Settings → Secrets and variables → Actions → Variables), so set that before the first apply that needs it.
- The Lambda bundle: `npm run build` from the repo root (writes `backend/dist/index.js`).

## Day to day

```sh
cd infra
tofu init
tofu plan
tofu apply
```

CI runs `tofu apply` on every push to `main`, after the database migration. Every branch also runs
`tofu fmt -check -recursive` and `tofu validate` (no backend, no AWS credentials), so run
`tofu fmt -recursive` before pushing. `tofu init` in CI uses `-lockfile=readonly`: after a provider
upgrade, commit the updated `.terraform.lock.hcl`, with hashes for `linux_amd64`
(`tofu providers lock -platform=linux_amd64 -platform=darwin_arm64`).

### New kinds of resources

CI's role (`github-actions.tf`) is scoped per resource ARN. Before a change that adds a new kind of
resource reaches `main`, add its statement to `github_actions_tofu` and apply the policy from your
machine:

```sh
tofu apply -target=aws_iam_role_policy.github_actions_tofu
```

Otherwise CI's apply fails with `AccessDenied` on the new resource.

### Alarm email

SNS sends a confirmation email when the subscription is created, or when `alert_email` changes, and delivers nothing
until it's confirmed. After confirming, check delivery with a test message:

```sh
aws sns publish --topic-arn arn:aws:sns:us-east-2:590184139982:new-jersey-sheriff-sale-scraper-alarms \
  --subject 'Scraper alarm test' --message 'Test notification from the scraper alarms topic.'
```

## Bootstrapping the state bucket

The state bucket is managed by this same config, so it has to exist before the `s3` backend can
use it. This is a one-time step and has already been done; it is kept here for disaster recovery.

1. Move `backend.tf` aside so OpenTofu uses local state, then `tofu init`.
2. Create only the state bucket:

   ```sh
   tofu apply \
     -target=aws_s3_bucket.tofu_state \
     -target=aws_s3_bucket_versioning.tofu_state \
     -target=aws_s3_bucket_public_access_block.tofu_state \
     -target=aws_s3_bucket_server_side_encryption_configuration.tofu_state
   ```

3. Restore `backend.tf` and copy the local state into the bucket: `tofu init -migrate-state`.
4. Delete the local `terraform.tfstate*` files.

If the state object is ever corrupted, restore a previous version from the bucket's version history.
