> **Before merging, the user must complete section 9 (manual steps).** In particular, 9.2, applying the CI IAM policy locally with `tofu`, must happen before the merge, or CI's first `tofu apply` fails on the new SNS and CloudWatch resources.

## 1. Env consolidation (thread A)

- [x] 1.1 `packages/database/src/client.ts`: drop the dotenv import and `config()` call, so it reads `process.env.DATABASE_URL` only
- [x] 1.2 `packages/database/src/migrate.ts`: load `<root>/.env` (not `.env.local`), then dynamically import `./client`
- [x] 1.3 `packages/database/drizzle.config.ts`: resolve `<root>/.env` with `path.resolve`
- [x] 1.4 `backend/src/modules/sheriffSale/handler.local.ts`: load `<root>/.env`, then dynamically import `./pipeline`, replacing the bare `config()`
- [x] 1.5 `frontend/package.json` `dev`: `dotenv -e ../.env -- next dev`
- [x] 1.6 Rename `NEXT_GOOGLE_MAPS_API_KEY` to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `frontend/src/pages/_app.tsx` and `turbo.json`, and fix the `vite.config.ts` comment
- [x] 1.7 Remove `ENV` and `NJ_SCRAPER_BUCKET_NAME` from `backend/src/environment.d.ts`, and `ENV` from `turbo.json` `globalEnv`
- [x] 1.8 `turbo.json`: `globalEnv` becomes `DATABASE_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NODE_ENV`, `PORT`, `VERCEL_URL`, and `globalDependencies` hashes `.env`, not `**/.env`
- [x] 1.9 Add `.env.example`. In `.gitignore`, add `!.env.example` and drop `!packages/database/.env`.
- [x] 1.10 Stale config: delete `backend/package-lock.json` and `backend/.npmignore`, and remove `next-env.d.ts` from `packages/database/tsconfig.json`
- [x] 1.11 Remove the unused `pg` devDependency from `packages/database`, and confirm the `package-lock.json` diff only removes `pg` and its exclusive transitive packages

## 2. Migration safety (thread B)

- [x] 2.1 Remove `prebuild` and `predev` from `packages/database/package.json`
- [x] 2.2 `migrate.ts`: `try/finally` around `sql.end()`, and a `.catch` that logs the error and sets `process.exitCode = 1`
- [x] 2.3 CI `migrate` job: drop `npm run db:generate`
- [x] 2.4 CI `build` job: add a drift-check step (`db:generate` for the database workspace, then fail on `git status --porcelain packages/database/drizzle`) with `timeout-minutes`, and update the placeholder-env comment
- [x] 2.5 Verify locally that the drift check passes on a clean tree, and fails after a throwaway schema edit (reverted afterwards)

## 3. CI hardening (thread C)

- [x] 3.1 `turbo.json`: `cache: false` on every `db:*` task, plus `persistent: true` on `db:studio`
- [x] 3.2 Add the branch-level `infra-check` job (mise opentofu, then `fmt -check -recursive`, `init -backend=false -lockfile=readonly`, `validate`), and make `migrate` need `[build, infra-check]`
- [x] 3.3 Pin every action to its commit SHA with a version comment (design decision 9)
- [x] 3.4 Pin the Vercel CLI to `vercel@64.5.0`, and pass `VERCEL_TOKEN` through the step env instead of `--token=`
- [x] 3.5 `deploy-backend`: `tofu init -input=false -lockfile=readonly`, and pass `TF_VAR_alarm_email: ${{ vars.ALARM_EMAIL }}`
- [x] 3.6 Split the `build` job's Build step into Build and Test
- [x] 3.7 Remove workflow-level and build-job `ENV`
- [x] 3.8 Correct the `prod`-environment branch-policy comments in `cicd.yml` and `infra/github-actions.tf`

## 4. Ops visibility and infra protection (thread D)

- [x] 4.1 `infra/scraper.tf`: `retention_in_days = 90` on the log group, an `aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0`, and remove `ENV` from the Lambda environment
- [x] 4.2 `infra/locals.tf`: remove `env` (and its comment)
- [x] 4.3 `infra/variables.tf`: optional `alarm_email` (string, default `""`)
- [x] 4.4 New `infra/alarms.tf`: SNS topic, a conditional email subscription, the DLQ-messages alarm, and the Lambda-errors alarm
- [x] 4.5 `infra/storage.tf`: archive bucket public access block, versioning, and noncurrent-version lifecycle
- [x] 4.6 `infra/github-actions.tf`: `AlarmTopic`, `ScraperAlarms`, and `DescribeAlarms` statements, plus locals for the new ARNs
- [x] 4.7 `tofu fmt -check -recursive`, `tofu init -backend=false`, `tofu validate`
- [x] 4.8 Read-only `tofu plan`, if AWS credentials and the prod `DATABASE_URL` are available: confirm only the expected adds and in-place updates (no destroys or replacements). Otherwise record that it was skipped.

## 5. Docker compose and local DB tooling

- [x] 5.1 Rewrite `docker-compose.yml` per design decision 13 (`name`, `postgres:15`, container name, `127.0.0.1:${POSTGRES_PORT:-5432}`, healthcheck, `unless-stopped`; no `version`, `expose`, `hostname`, or pgAdmin)
- [x] 5.2 `.claude/skills/db-query/scripts/query.sh` and `SKILL.md`: build the local URL from `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_PORT`/`POSTGRES_DB` in root `.env`, with defaults, and refer to the new container name
- [x] 5.3 `docker compose config` parses the file (if docker is available)

## 6. Docs

- [x] 6.1 Root README: fix the `packages/` line (no `config` package); add a "Local database" section (`.env.example`, `docker compose up -d`, `db:migrate`, `POSTGRES_PORT`, recreating an incompatible volume); add the expand-only rule and the explicit `db:generate` workflow to "Deploying"
- [x] 6.2 Backend README: note that local scripts read `<root>/.env`
- [x] 6.3 infra README: drop the `ENV=prod` line, list the alarms, topic, `alarm_email`/`ALARM_EMAIL`, archive bucket protections, the branch `infra-check`, and the "apply new IAM statements locally first" rule

## 7. Cleanup

- [x] 7.1 Delete `audit-brief.md` (its content is folded into this change)
- [x] 7.2 `openspec validate harden-ci-env-and-ops --strict`

## 8. Gates

- [x] 8.1 `npx vp check`
- [x] 8.2 `npm run build`
- [x] 8.3 `npm run test`
- [x] 8.4 `tofu fmt -check -recursive` and `tofu validate` in `infra/`

## 9. Manual steps (user, before merging; not done by the agent)

- [ ] 9.1 **Vercel:** rename the project env var `NEXT_GOOGLE_MAPS_API_KEY` to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` for Production (and Preview/Development if set). If the variable doesn't exist, add it. Restrict the key by HTTP referrer in Google Cloud.
- [ ] 9.2 **AWS / OpenTofu, before merging:** from `infra/` with prod credentials and `TF_VAR_database_url` set, run `tofu plan`, then `tofu apply -target=aws_iam_role_policy.github_actions_tofu`, so the CI role can manage the SNS topic and alarms. A full local `tofu apply` after `npm run build` also works.
- [ ] 9.3 **GitHub (optional):** set `prod` environment variable `ALARM_EMAIL` (and `TF_VAR_alarm_email` in `mise.local.toml` for local plans), then confirm the SNS subscription email after the first apply
- [ ] 9.4 **GitHub:** delete the unused `prod` environment variable `ENV`
- [ ] 9.5 **GitHub:** narrow the `prod` environment's deployment branch policy from `main` + `cicd*` to `main` only
- [ ] 9.6 **Local:** move any values from `.env.local` into `.env` and delete `.env.local`. This worktree's `.env` (and probably the main checkout's) sets `DATABASE_URL` to the **prod** Railway database, so `db:migrate`, `db:push`, `start:newJerseyScraper` and `replay:archive` run locally all write to prod. Point it at the local container (see `.env.example`), and keep the prod URL only in `mise.local.toml` (`PROD_DATABASE_URL` / `TF_VAR_database_url`). If `docker compose up` reports incompatible data files, run `docker compose down -v`, then `docker compose up -d && npm run db:migrate`.
- [ ] 9.7 **Follow-up for `upgrade-backend-dependencies`:** `@types/mocha` alongside `@types/jest`, and Jest `testEnvironment: 'jsdom'` for Lambda code
