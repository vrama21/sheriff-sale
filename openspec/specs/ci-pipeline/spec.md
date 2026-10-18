# ci-pipeline Specification

## Purpose

TBD - created by archiving change harden-ci-env-and-ops. Update Purpose after archive.

## Requirements

### Requirement: Separate build and test steps

The CI `build` job SHALL run `npm run build` and `npm run test` as separate steps, so a test failure is reported as a test step failing.

#### Scenario: Failing test

- **WHEN** a test fails on a branch
- **THEN** the `build` job's Test step fails and its Build step is green

### Requirement: Migration drift check

The CI `build` job SHALL run `drizzle-kit generate` for `packages/database`, using the job's placeholder `DATABASE_URL` and no database connection, before building. It SHALL fail if `git status --porcelain packages/database/drizzle` is non-empty afterwards. The step SHALL have a timeout, so an interactive drizzle-kit prompt can't hang the job.

#### Scenario: Schema changed without a migration

- **WHEN** a branch edits `packages/database/src/schema/` without committing the generated migration
- **THEN** the drift-check step fails and lists the uncommitted files under `packages/database/drizzle`

#### Scenario: Schema and migrations agree

- **WHEN** a branch's schema matches its committed migrations
- **THEN** the drift-check step passes and leaves the working tree clean

### Requirement: Database tasks are never cached

`turbo.json` SHALL set `cache: false` on `db:generate`, `db:migrate`, `db:pull`, `db:push`, and `db:studio`, and SHALL set `persistent: true` on `db:studio`.

#### Scenario: Migrate after a local reset

- **WHEN** `npm run db:migrate` runs twice, with the local database recreated in between
- **THEN** the second run connects and applies every migration, and turbo reports no cache hit

### Requirement: Pinned CI dependencies

Every `uses:` in `.github/workflows/cicd.yml` SHALL reference a full 40-character commit SHA, followed by a comment naming the release version. The Vercel CLI SHALL be installed at an exact version. Every `tofu init` in CI SHALL pass `-lockfile=readonly`, and `infra/.terraform.lock.hcl` SHALL contain hashes covering `linux_amd64` for every provider.

#### Scenario: No floating references

- **WHEN** the workflow is searched for `uses: [^@]+@v` and `@latest`
- **THEN** no matches are found

#### Scenario: Provider lock is enforced

- **WHEN** CI runs `tofu init` and the lockfile lacks a matching hash for a provider
- **THEN** init fails instead of updating the lockfile

### Requirement: Secrets stay out of command lines

CI SHALL pass the Vercel token to the CLI through the `VERCEL_TOKEN` environment variable. The workflow SHALL NOT pass secrets as command-line arguments.

#### Scenario: No token flag

- **WHEN** the workflow is searched for `--token`
- **THEN** no matches are found
