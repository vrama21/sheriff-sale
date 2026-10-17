# database-toolchain Specification

## Purpose
TBD - created by archiving change upgrade-drizzle. Update Purpose after archive.
## Requirements
### Requirement: Pinned Drizzle versions

`packages/database/package.json` SHALL pin `drizzle-orm` and `drizzle-kit` to exact versions, with no range operators. `drizzle-orm` SHALL be 0.41.0 or later, so that `numeric` columns support `mode: 'number'`. The two packages SHALL be a matched pair: when one is upgraded, the other SHALL be upgraded in the same change.

#### Scenario: Exact pins

- **WHEN** `packages/database/package.json` is read
- **THEN** `drizzle-orm` is `0.45.3` and `drizzle-kit` is `0.31.11`, with no `^` or `~`

#### Scenario: Numeric number mode type-checks

- **WHEN** a column is declared as `numeric('x', { precision: 12, scale: 2, mode: 'number' })`
- **THEN** `typeof table.$inferSelect['x']` is `number | null` and `tsc --noEmit` passes

### Requirement: Generate is a no-op on an unchanged schema

When the Drizzle schema matches the latest committed snapshot, `npm run db:generate` SHALL emit no new migration file, SHALL leave `drizzle/meta/_journal.json` unchanged, and SHALL exit 0. This SHALL hold after every Drizzle upgrade, because CI's `migrate` job runs `db:generate` on `main` immediately before `db:migrate`.

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

#### Scenario: Listing save keeps its shape

- **WHEN** the backend's `saveListing` tests run with `@sheriff-sale/database` mocked
- **THEN** they pass unchanged: one transaction, an insert with `onConflictDoNothing({ target: listings.propertyId })` and `returning`, and one multi-row status-history insert

