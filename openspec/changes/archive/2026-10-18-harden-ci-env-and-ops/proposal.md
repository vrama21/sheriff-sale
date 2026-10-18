## Why

An audit of the CI pipeline, docker compose, and config files found that CI can write and apply an unreviewed migration to prod, that local tools can point at different databases, that the Google Maps key never reaches the browser, and that the archive bucket has none of the state bucket's protections. Each is cheap to fix now, and the migration one could corrupt prod on any schema drift.

## What Changes

- **Env consolidation (A).** The repo-root `.env` becomes the only local env file. Every local entry point loads it explicitly. Library code (`packages/database/src/client.ts`) reads `process.env` only and no longer imports dotenv. `.env.local` is no longer read anywhere. A committed `.env.example` lists every local variable. Both READMEs document local DB setup. **BREAKING (local):** anyone relying on `.env.local` must move its values into `.env`.
- **Maps key fix (A).** `NEXT_GOOGLE_MAPS_API_KEY` is renamed to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, so Next.js inlines it into the client bundle. **BREAKING (deploy):** the Vercel env var must be renamed by hand before merge.
- **Dead env removed (A).** `ENV` (CI workflow, build job, Lambda environment, `infra/locals.tf`, types) and `NJ_SCRAPER_BUCKET_NAME` (types) go. `turbo.json` `globalEnv` lists only variables that code reads. The Lambda change is an in-place update.
- **Migration safety (B).** CI never generates migrations. `migrate` only applies committed migrations, and `packages/database` loses its `prebuild`/`predev` generate hooks. The `build` job fails when the schema has drifted from the committed migrations. Migrations must be expand-only relative to the code they deploy with, and this is now a written rule. `migrate.ts` closes its connection and sets a non-zero exit code on failure.
- **CI hardening (C).** Turbo no longer caches `db:*` tasks. A branch-level `infra-check` job runs `tofu fmt -check` and `tofu validate` with no AWS credentials. Every action is pinned to a full commit SHA. The Vercel CLI is pinned. `tofu init` uses `-lockfile=readonly`. Build and test are separate steps. The Vercel token is passed through the environment. Comments about the `prod` environment's branch policy are corrected.
- **Ops (D).** The scraper log group gets 90-day retention, and async retries are set to 0, so a failed run goes straight to the DLQ. Failure alarms (an SNS topic and CloudWatch alarms) are out of scope and will be a separate change.
- **Infra protection (D).** The `nj-sheriff-sale` archive bucket gets Block Public Access, versioning, and a lifecycle rule that expires noncurrent versions. The CI role's existing statements already cover every new resource, so its policy doesn't change.
- **Docker compose.** Postgres is pinned to major 15, matching prod (Railway, 15.5). The compose file gets a fixed project name, a project-specific container name, a localhost-only and configurable host port, a `pg_isready` healthcheck, and `restart: unless-stopped`. pgAdmin and the obsolete `version` key are removed. **BREAKING (local):** a local volume initialised by a newer Postgres major must be recreated.
- **Stale config.** Remove `backend/package-lock.json`, `backend/.npmignore`, the `next-env.d.ts` include in `packages/database/tsconfig.json`, the `!packages/database/.env` gitignore negation, and the README's claim about a shared `config` package.

### Manual steps for the user (before merging)

1. **Vercel:** rename the production (and preview, if set) env var `NEXT_GOOGLE_MAPS_API_KEY` to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
2. **GitHub:** delete the now-unused `ENV` variable. Tighten the `prod` environment's deployment branch policy from `main` + `cicd*` to `main` only.
3. **Local:** move any `.env.local` values into `.env`, and recreate the local Postgres volume if it was initialised by a major newer than 15.

## Capabilities

### New Capabilities

- `local-environment`: The single root `.env`, the committed `.env.example`, how entry points load env, which variables are declared, the public Maps key, and the docker compose Postgres service.
- `ci-pipeline`: CI job structure and supply-chain rules: separate build and test steps, the migration drift check, uncached `db:*` turbo tasks, SHA-pinned actions, the pinned Vercel CLI, token handling, and the read-only provider lockfile.

### Modified Capabilities

- `database-toolchain`: Generating is a developer-only action. The no-op-generate requirement now backs the CI drift check instead of a CI generate step. Migrations must be expand-only per deploy, and the migrate script must fail cleanly.
- `infra-delivery`: Branches run offline `tofu fmt`/`validate`. The `prod` environment no longer holds `ENV`, and its branch policy is named as the boundary for prod secrets.
- `workspace-dependencies` (added by the unarchived `upgrade-backend-dependencies` change): `dotenv` moves to `packages/database`'s devDependencies, because the client no longer imports it at runtime.
- `scraper-infrastructure`: The archive bucket gains Block Public Access, versioning, and a lifecycle rule. The Lambda environment drops `ENV`. The log group gets retention. Adds the 0-retry async config. Single-environment naming no longer mentions `ENV`.

## Impact

- **Code:** `packages/database` (`client.ts`, `migrate.ts`, `drizzle.config.ts`, `package.json`, `tsconfig.json`), `backend/src/modules/sheriffSale/handler.local.ts`, `backend/src/environment.d.ts`, `frontend/package.json`, `frontend/src/pages/_app.tsx`.
- **Config:** `.github/workflows/cicd.yml`, `turbo.json`, `vite.config.ts` (comment), `.gitignore`, `.env.example` (new), `docker-compose.yml`, `.claude/skills/db-query` (local connection reads `POSTGRES_*` from `.env`).
- **Infra:** `infra/scraper.tf`, `infra/storage.tf`, `infra/github-actions.tf`, `infra/locals.tf`, Plan impact: Lambda environment update, log group retention, a new event invoke config, and new archive bucket versioning/PAB/lifecycle configs. The CI role policy is unchanged.
- **Dependencies:** moves `dotenv` (18.0.8, unchanged) from `packages/database` dependencies to devDependencies. No version bumps. `pg` was removed by `upgrade-backend-dependencies` (#26), and this branch's own removal of it was dropped when merging `main`.
- **Docs:** root, backend, and infra READMEs.
