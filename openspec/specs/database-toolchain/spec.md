# database-toolchain Specification

## Purpose

TBD - created by archiving change upgrade-drizzle. Update Purpose after archive.

## Requirements

### Requirement: Pinned Drizzle versions

`packages/database/package.json` SHALL pin `drizzle-orm` and `drizzle-kit` to exact versions, with no range operators. `drizzle-orm` SHALL be 0.41.0 or later, so that `numeric` columns support `mode: 'number'`, and SHALL stay below 1.0 until a stable 1.0 is released. The two packages SHALL be a matched pair: when one is upgraded, the other SHALL be moved in the same change to the newest release on its current minor line, or left unchanged if it is already the newest.

#### Scenario: Exact pins

- **WHEN** `packages/database/package.json` is read
- **THEN** `drizzle-orm` is `0.45.4` and `drizzle-kit` is `0.31.11`, with no `^` or `~`

#### Scenario: Numeric number mode type-checks

- **WHEN** a column is declared as `numeric('x', { precision: 12, scale: 2, mode: 'number' })`
- **THEN** `typeof table.$inferSelect['x']` is `number | null` and `tsc --noEmit` passes

### Requirement: Generate is a no-op on an unchanged schema

When the Drizzle schema matches the latest committed snapshot, `npm run db:generate` SHALL emit no new migration file, SHALL leave `drizzle/meta/_journal.json` unchanged, and SHALL exit 0. This SHALL hold after every Drizzle upgrade, because CI's `build` job runs `drizzle-kit generate` as a drift check on every branch, and fails on any change it writes.

#### Scenario: Upgrade adds no migration

- **WHEN** `DATABASE_URL=postgres://localhost/unused npm run db:generate` runs in `packages/database` after the upgrade, with no schema edits
- **THEN** it reports no schema changes, and `git status` shows no new files under `packages/database/drizzle/` and no change to `_journal.json`

#### Scenario: Committed snapshots are readable

- **WHEN** drizzle-kit reads the committed snapshots `0000`–`0006`
- **THEN** it does not ask for `drizzle-kit up` and does not exit early without diffing

### Requirement: Consumers build against the upgraded ORM

The `backend`, `frontend` and `packages/database` workspaces SHALL type-check, build, test and lint against the upgraded `drizzle-orm`, with no change to the SQL their queries produce.

#### Scenario: Workspace gates pass

- **WHEN** `npm run build` and `npm run test` run at the repo root, and `npm run lint` runs in `backend`, `frontend` and `packages/database`
- **THEN** all of them pass

#### Scenario: Listing sync keeps its shape

- **WHEN** the backend's `syncListing` tests run under `vp test` with `@sheriff-sale/database` mocked
- **THEN** they pass with no change to the database calls they assert

### Requirement: Migrations are generated only by developers

Generating a migration SHALL be an explicit developer action (`npm run db:generate`), whose output is reviewed and committed. `packages/database/package.json` SHALL NOT run `drizzle-kit generate` from a lifecycle script such as `prebuild` or `predev`. CI SHALL NOT generate migrations in any job that connects to a database. The `migrate` job SHALL only apply the migrations committed under `packages/database/drizzle`.

#### Scenario: Build does not generate

- **WHEN** `npm run build` runs at the repo root after a schema edit with no new migration
- **THEN** no file under `packages/database/drizzle/` is created or modified

#### Scenario: Migrate job applies committed migrations only

- **WHEN** `.github/workflows/cicd.yml`'s `migrate` job is read
- **THEN** it runs `npm run db:migrate` and does not run `db:generate` or `drizzle-kit generate`

### Requirement: Migrations are expand-only per deploy

Every migration SHALL be backward compatible with the application code deployed before it, because CI applies migrations before deploying the backend and frontend, and doesn't roll back the database when a deploy fails. A destructive change (dropping or renaming a table or column, or adding a constraint the deployed code can violate) SHALL ship in a later deploy than the code change that stops depending on the old shape. The root README's "Deploying" section SHALL state this rule.

#### Scenario: Dropping a column

- **WHEN** a column is no longer needed
- **THEN** one deploy removes every read and write of it, and a later deploy's migration drops it

#### Scenario: Deploy fails after migrate

- **WHEN** `migrate` succeeds on `main` and `deploy-backend` or `deploy-frontend` fails
- **THEN** the previously deployed code keeps working against the migrated schema

### Requirement: Migrate script fails cleanly

`packages/database/src/migrate.ts` SHALL close its database connection whether the migration succeeds or fails. On failure, it SHALL log the error and exit with a non-zero code.

#### Scenario: Migration error

- **WHEN** a migration fails to apply
- **THEN** the script prints the error, closes the connection, and exits with code 1
