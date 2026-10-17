## Context

This change folds an explore-mode audit into one change. The audit covered `.github/workflows/cicd.yml`, `docker-compose.yml`, `turbo.json`, `infra/`, `packages/database`, and the env/config files. Every finding was re-checked against the code before it went into this design. What the checks found:

- **Env files.** `drizzle.config.ts`, `client.ts`, and `replay/index.ts` load the root `.env`. `migrate.ts` loads root `.env.local` first, so `.env.local` wins. The frontend `dev` script reads `../.env.local`. `handler.local.ts` calls a bare `config()` after `./pipeline` has already loaded the client. `.gitignore`'s `**/.env.*` matches `.env.example`, and its `!packages/database/.env` negation names a file that doesn't exist.
- **Maps key.** `_app.tsx` reads `process.env.NEXT_GOOGLE_MAPS_API_KEY`, and `next.config.js` has no `env` block, so the value is `undefined` in the browser. A local `vercel pull` (`.vercel/.env.production.local`) lists only system variables, so the repo can't tell whether the key exists in Vercel at all. See Open Questions.
- **Dead variables.** Nothing reads `ENV` or `NJ_SCRAPER_BUCKET_NAME`. `ENV` is set by the workflow (`vars.ENV`), by the build job (`ci`), and by the Lambda (`local.env = "prod"`). Its type, `'main' | 'prod'`, excludes `ci`.
- **Migrations.** `migrate` runs `db:generate` then `db:migrate` against prod. `prebuild`/`predev` in `packages/database` run `drizzle-kit generate` on every build. `migrate.ts` ends with `void migrateDb()`.
- **Turbo.** No `db:*` task sets `cache: false`. `globalEnv` lists `ENV`, `POSTGRES_HOST`, and the three `POSTGRES_*` variables, which turbo tasks never read.
- **Branch CI.** Branches run no infra checks. The OIDC role trusts only `environment:prod`.
- **Pinning.** Actions are pinned by major tag, and `vercel@latest` floats. `infra/.terraform.lock.hcl` has `zh:` hashes for both providers' linux_amd64 packages. This was checked against the registry's `shasum` for `aws` 6.69.1 and `archive` 2.8.1.
- **Ops.** The archive bucket has encryption only. The log group has no retention. The Lambda uses the default 2 async retries.
- **Prod database.** `select version()` (read-only, via db-query) returns PostgreSQL 15.5.
- **`next build`.** The build succeeds with no `DATABASE_URL` and no root `.env`: page-data collection never instantiates the database client. So the client can stop loading dotenv, and the build job's placeholder `DATABASE_URL` is now needed only by the drift check (`drizzle.config.ts` throws when it's unset).
- **`pg` driver.** drizzle-kit 0.31.11 checks for `pg` first and falls back to `postgres` for `push`/`pull`/`studio`. `postgres` is already a dependency, so `pg` is unused.

Constraints:

- Never run `tofu apply`, and never change Vercel, GitHub, or AWS settings directly.
- Don't bump dependency versions. The sibling worktree `upgrade-backend-dependencies` owns that.
- Keep backend test tooling as it is: `@types/mocha`, and Jest's `jsdom` environment.

## Goals / Non-Goals

**Goals:**

- One local env file, `<root>/.env`, read the same way by every tool, with a committed `.env.example`.
- No path by which CI writes a migration. A branch that changes the schema without committing its migration fails CI.
- A written deploy-order rule for destructive migrations.
- Infra syntax and format checked on every branch. CI dependencies are pinned and reproducible.
- Scraper failures notify someone. The archive bucket is protected like the state bucket.
- A local Postgres that matches prod's major and doesn't collide with other projects.

**Non-Goals:**

- **`tofu plan` on branches.** It needs a second OIDC role that trusts branch refs, read access to every managed resource, and `TF_VAR_database_url`. That means the prod database URL would be exposed to any branch, since the plan reads it into the Lambda environment diff. The benefit is small: one maintainer who already plans locally, and a config that changes rarely. The decision is to defer it. Revisit if more contributors push infra changes. `fmt` and `validate` catch most mistakes without credentials.
- **Enforcing `packageManager: npm@11.19.1` in CI.** Node 24 from mise bundles npm 11, which reads the v3 lockfile the same way. Corepack is being dropped from Node after 24, and installing a second npm globally adds a moving part for a patch-level difference. Turbo only needs the field to resolve workspaces, per the node-toolchain spec. The decision is to leave it as is.
- **Changing what `deploy-frontend` hands to Vercel.** See decision 9.
- **Dependency bumps, and backend test tooling** (`@types/mocha` alongside `@types/jest`, Jest `testEnvironment: 'jsdom'`). Left as follow-ups for `upgrade-backend-dependencies`.
- **KMS-encrypting the SNS topic.** CloudWatch alarms publishing to a KMS-encrypted topic need a customer-managed key with a key policy. The alarm payload is just alarm metadata.

## Decisions

### 1. Root `.env` is loaded by entry points, never by library code

`packages/database/src/client.ts` stops importing dotenv and reads `process.env.DATABASE_URL` only. The Lambda, Next.js and Vercel already supply the environment, and a library reading a path relative to its own `dist` is fragile. Each local entry point loads `<root>/.env`, resolved from its own `__dirname`:

| Entry point                                | Loads root `.env` by                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `packages/database/drizzle.config.ts`      | `config({ path })` (already does)                                                      |
| `packages/database/src/migrate.ts`         | `config({ path })`, then a dynamic `import('./client')` so the client is created after |
| `backend/.../handler.local.ts`             | `config({ path })`, then a dynamic `import('./pipeline')`                              |
| `backend/.../replay/index.ts`              | already does, and imports the database dynamically                                     |
| `frontend` `dev`                           | `dotenv -e ../.env -- next dev`                                                        |
| `docker-compose.yml`                       | `env_file: .env` (project dir is the root)                                             |
| `.claude/skills/db-query/scripts/query.sh` | reads `POSTGRES_*` from root `.env`                                                    |

Dynamic imports (the pattern `replay/index.ts` already uses) make the load order explicit. A statement placed between static imports would depend on how the import is compiled.

Alternatives considered:

- **Keep dotenv in `client.ts` and move it to dependencies.** Rejected: it hides which file each tool reads, which is the bug.
- **mise `[env] _.file = ".env"`.** Rejected: it couples the app's env to the user's shell tooling, and to mise-action in CI, where no `.env` exists.

`dotenv` stays a devDependency of `packages/database`, because only the dev-time `drizzle.config.ts` and `migrate.ts` import it now. That also stops tsdown from inlining dotenv into `dist`.

### 2. `.env.example` lists the local variables

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=postgres
POSTGRES_PORT=5432
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

`.gitignore` gains `!.env.example` after `**/.env.*` and drops the stale `!packages/database/.env`. `turbo.json` `globalDependencies` goes from `**/.env` to `.env`, the only env file left, and `.env.local` is not added.

### 3. Maps key gets the `NEXT_PUBLIC_` prefix

Rename it in `_app.tsx`, `turbo.json` `globalEnv`, `.env.example`, and the comment in `vite.config.ts`. Adding an `env` block to `next.config.js` was rejected: the prefix is the idiomatic way, and it makes the key's public exposure explicit. A browser Maps key is public by design and should be restricted by HTTP referrer in Google Cloud. The Vercel rename is a manual step.

### 4. Remove `ENV` and `NJ_SCRAPER_BUCKET_NAME`

Nothing reads either one, and the archive bucket name is fixed by spec. They're removed from:

- the workflow (both levels)
- the Lambda `environment` and `local.env`
- `environment.d.ts`
- `turbo.json`
- the infra README
- the specs

Plan impact: one in-place update to `aws_lambda_function.scraper`, whose environment drops `ENV`. The GitHub `prod` variable `ENV` becomes unused, and deleting it is an optional manual step. `globalEnv` becomes `DATABASE_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NODE_ENV`, `PORT`, and `VERCEL_URL`. Docker reads `POSTGRES_*`, but turbo doesn't.

### 5. Migrations are generated only by developers, and drift fails the build

- Remove `prebuild`/`predev` from `packages/database`.
- Remove `npm run db:generate` from the `migrate` job.
- The `build` job gains a step: `npm run db:generate --workspace=@sheriff-sale/database`, then fail with `::error::` if `git status --porcelain packages/database/drizzle` is non-empty.
  - drizzle-kit `generate` diffs the TS schema against the committed snapshots and never connects. The placeholder `DATABASE_URL` satisfies `drizzle.config.ts`.
  - It runs before Build, so no build output can touch `drizzle/`.
  - `drizzle-kit check` (snapshot consistency) is also cheap, but it overlaps with generate, which already fails on unreadable snapshots. It's skipped.
- A rename-ambiguous schema change makes drizzle-kit prompt. With no TTY, the step errors or hangs. A `timeout-minutes: 5` on the step bounds the hang, and the error points the developer to running `db:generate` locally.

`migrate.ts` wraps the migration in `try/finally` that calls `sql.end()`. A `.catch` logs the error and sets `process.exitCode = 1`, so a failure exits 1 after the pool closes, not on an unhandled-rejection crash.

### 6. Expand-only migrations per deploy

`migrate` runs before both deploys, and a migration can't be rolled back automatically. So every migration must be backward compatible with the code currently deployed. A destructive change (dropping or renaming a column or table, or tightening a constraint the old code can violate) ships in a later deploy than the code that stops depending on it. This is a database-toolchain requirement, and the root README's "Deploying" section documents it. If `migrate` succeeds and a deploy fails, the expand-only rule means the old code still works against the new schema. The fix is to re-run or fix the deploy, not to roll back the database.

### 7. Turbo `db:*` tasks are uncached

`db:generate`, `db:migrate`, `db:pull`, `db:push`, and `db:studio` get `cache: false`, and `db:studio` also gets `persistent: true`. Their effects live in a database or in files turbo doesn't declare as outputs, so a cache hit is always wrong.

### 8. Branch-level `infra-check` job

A new `infra-check` job runs on every branch, outside any environment and with no credentials:

- `mise-action` with `install_args: opentofu`
- `tofu fmt -check -recursive`
- `tofu init -backend=false -input=false -lockfile=readonly`
- `tofu validate`

`migrate` needs both `build` and `infra-check`, so a bad format on `main` blocks the deploy. `deploy-backend`'s `tofu init` also gains `-lockfile=readonly`, so CI can never silently pick up different provider builds. The infra-delivery requirement "CI SHALL NOT run any OpenTofu command on other branches" is modified to allow these offline commands.

### 9. Supply chain

- **Actions are pinned to the commit their major tag currently resolves to**, with the exact version in a trailing comment. This changes no behaviour; it freezes what runs today.

  | Action                                  | Version | Commit                                     |
  | --------------------------------------- | ------- | ------------------------------------------ |
  | `actions/checkout`                      | v4.4.0  | `11d5960a326750d5838078e36cf38b85af677262` |
  | `jdx/mise-action`                       | v5.2.0  | `9b200bcecbfd6303e69a4a261b2e09e3757440a7` |
  | `aws-actions/configure-aws-credentials` | v6.3.0  | `e1253824e5c10ff9df46874f81ed3ec929e19cfd` |
  | `actions/upload-artifact`               | v4.6.2  | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
  | `actions/download-artifact`             | v4.3.0  | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |

  Dependabot or Renovate for action updates is a possible follow-up, not part of this change.

- **The Vercel CLI is pinned to `vercel@64.5.0`**, today's `latest` and the version of the last local `vercel build`.
- **The Vercel token goes through the job environment.** `VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}` is set on the step env, and the CLI reads it, so the token never appears in a process's argv.
- **Build and test are separate steps** in the `build` job.
- **`deploy-frontend` keeps downloading `packages/database/dist`.** The linked project (`.vercel/project.json`) has Root Directory `frontend` and null install and build commands. The last `builds.json` shows the zero-config `@vercel/next` builder, which runs `frontend`'s `build` script (`next build`). Nothing in that path builds `@sheriff-sale/database`, whose `main` is `dist/index.cjs`, so the downloaded `dist` is very likely load-bearing. Behaviour stays unchanged, and the dashboard settings are an open question.

### 10. Alarms and Lambda async behaviour

A new `infra/alarms.tf` adds:

- **SNS topic** `new-jersey-sheriff-sale-scraper-alarms`.
- **Optional email subscription** from the variable `alarm_email`, which defaults to `""`, with `count = var.alarm_email == "" ? 0 : 1`. CI passes `TF_VAR_alarm_email: ${{ vars.ALARM_EMAIL }}`, so CI and local applies agree. An empty GitHub variable means no subscription. Without this, a subscription created locally would be destroyed by the next CI apply. No address is hardcoded.
- **`…-dlq-messages`:** `AWS/SQS` `ApproximateNumberOfMessagesVisible`, Maximum > 0 over one 300-second period. It stays in ALARM while the DLQ holds anything.
- **`…-errors`:** `AWS/Lambda` `Errors` for the function, Sum > 0 over one 300-second period. It fires once per failed run, timeouts included.
- **Both alarms:** `treat_missing_data = "notBreaching"` and `alarm_actions = [topic]`. A failed run triggers both alarms. That's accepted: one says it failed, and the other says the event is waiting in the DLQ.

`infra/scraper.tf` adds:

- `retention_in_days = 90` on the log group. That covers a quarter of daily runs for debugging, at negligible cost.
- `aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0`. A failed run goes straight to the DLQ, not two more 15-minute scrapes against the county sites. Re-running is a manual, deliberate action.

### 11. Archive bucket protection

`infra/storage.tf` adds:

- `aws_s3_bucket_public_access_block` (all four settings), matching `state.tf`.
- `aws_s3_bucket_versioning`, set to Enabled.
- `aws_s3_bucket_lifecycle_configuration`: noncurrent versions expire after 30 days, and incomplete multipart uploads are aborted after 7.

Keys are dated, and a same-day re-run overwrites an object. Versioning protects against accidental deletes and overwrites, and the lifecycle rule bounds its cost. Versioning can be suspended later but never fully removed. That's acceptable for an archive that already sets `prevent_destroy`.

### 12. CI IAM policy additions

New statements in `data.aws_iam_policy_document.github_actions_tofu`:

- **`AlarmTopic`:** `sns:*` on the topic ARN and `<topic ARN>:*`, which covers subscriptions.
- **`ScraperAlarms`:** `cloudwatch:*` on `arn:aws:cloudwatch:us-east-2:590184139982:alarm:new-jersey-sheriff-sale-scraper-*`.
- **`DescribeAlarms`:** `cloudwatch:DescribeAlarms` on `*`. It's read-only, and the provider's refresh path may call it unscoped, like the existing `DescribeLogGroups`.

Already covered, and verified against the existing statements:

- Versioning, Block Public Access, and lifecycle on the archive bucket are bucket-level `s3:*`, which `ArchiveBucket` grants.
- The event invoke config and log retention fall under `lambda:*` on the function ARN and `logs:*` on the log group.

CI can't create the topic and alarms until the widened policy exists, so the policy must be applied locally first. That's a manual step, done with a targeted apply before merging.

### 13. Docker compose

- `name: sheriff-sale`, so every worktree and checkout shares one compose project and one `sheriff-sale_postgres-data` volume, matching the main checkout's directory-derived name.
- `image: postgres:15`, prod's major. The 15.x image keeps PGDATA at `/var/lib/postgresql/data`, so the mount stays.
- `container_name: sheriff-sale-postgres`, and `restart: unless-stopped`.
- `ports: "127.0.0.1:${POSTGRES_PORT:-5432}:5432"`. Compose reads `POSTGRES_PORT` from the root `.env`, so a developer whose 5432 is taken sets one variable, and `query.sh` and `DATABASE_URL` follow. The default stays 5432, so existing `.env` files keep working. A different fixed port was rejected, because it breaks every existing `DATABASE_URL` for a collision that only some machines have.
- A `pg_isready` healthcheck using `POSTGRES_USER`/`POSTGRES_DB`.
- Removed: `version`, `expose`, `hostname`, and pgAdmin. Nothing references pgAdmin, and `npm run db:studio` covers the need.

`query.sh` builds its local URL from `POSTGRES_USER` (default `postgres`), `POSTGRES_PASSWORD`, `POSTGRES_PORT` (default `5432`), and `POSTGRES_DB` (default `postgres`), all read from root `.env`.

### 14. Prod environment branch policy

Every prod job is gated by `if: github.ref == 'refs/heads/main'`. But that check lives in the workflow file, which anyone pushing a `cicd*` branch controls. The `prod` environment's branch policy (main and `cicd*`) is the real boundary, for both the OIDC role and the prod secrets. The comments in `cicd.yml` and `github-actions.tf` are corrected to say this, and narrowing the policy to `main` is listed as a manual step.

## Risks / Trade-offs

- **Pinning Postgres 15 breaks a local volume initialised by `latest` (16–18)** → Postgres refuses to start with "database files are incompatible with server". The README says to `docker compose down -v` and re-run `npm run db:migrate`. Local data is disposable, and replay can repopulate it.
- **The drift check can hang on an interactive rename prompt** → bounded by `timeout-minutes`, and it fails safe (CI red).
- **Removing `.env.local` loading silently changes which DB a developer's tools hit** → the proposal and README call it out. After this change every tool agrees, which is the point.
- **The developer `.env` currently holds the prod `DATABASE_URL`.** This was found during apply, by comparing it to `PROD_DATABASE_URL` without printing it. Every local tool already writes to prod, and that includes `db:migrate`, because this worktree has no `.env.local`. This change doesn't make it worse, but the single-file rule makes it the only answer → `.env.example` and the README default to the local container. Repointing `.env` is a manual step, because the agent doesn't edit a developer's gitignored secrets.
- **Merging before the IAM policy is applied** → CI's `tofu apply` fails with AccessDenied on SNS or CloudWatch, after `migrate` has already run. The failure is loud, and re-running after a local targeted apply recovers.
- **Merging before the Vercel rename** → the Maps key stays undefined in the browser, as it is today. No regression, just no fix yet.
- **Enabling versioning is one-way** → the lifecycle rule bounds storage. Prod can suspend it later if needed.
- **0 async retries means a transient county-site failure isn't retried automatically** → the DLQ alarm now makes it visible, and a manual re-invoke is cheap. Before this change, retries were silent.
- **Spec overlap with the unarchived `isolate-sheriff-sale-module` change**, which also modifies "Scraper Lambda function" → this change's MODIFIED text already uses that change's handler path. Archive `isolate-sheriff-sale-module` first, or its older text, still with `ENV`, would overwrite this one.

## Migration Plan

1. Before merge, done by the user:
   - Rename the Vercel env var.
   - Run a targeted local `tofu apply` of `aws_iam_role_policy.github_actions_tofu`.
   - Optionally set `ALARM_EMAIL`.
2. Merge to `main`. CI then:
   - runs `build` (drift check, build, test) and `infra-check`
   - runs `migrate`, which applies committed migrations only
   - runs `deploy-backend`: `tofu apply` creates the topic, alarms, event invoke config, and bucket protections, and updates the Lambda environment and log retention
   - runs `deploy-frontend` with the pinned CLI
3. Confirm the SNS subscription email if one was set.
4. **Rollback:** revert the commit. `tofu apply` then removes the alarms, topic, and invoke config, and restores `ENV`. Bucket versioning can only go to Suspended, which is the one non-reversible step.

## Open Questions

- **Does the Vercel project currently have the Maps key under any name?** A local `vercel pull` shows only system variables, though sensitive variables may be omitted. If the key was never set, the manual step becomes "add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`" rather than "rename".
- **Vercel dashboard build settings.** The repo's `.vercel/project.json` shows null install and build commands with Root Directory `frontend`. If the dashboard overrides the build command (for example, to a turbo build that builds `@sheriff-sale/database`), the `dist` download in `deploy-frontend` is redundant and could be dropped.
- **`ALARM_EMAIL` recipient**, and whether email is the right channel at all. An SNS-to-Slack or SMS subscription would also work.
- **Branch `tofu plan`.** Deferred, as described under Non-Goals. Revisit if contributors grow.
