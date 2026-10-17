## Why

`validate-scraped-listings` needs money columns that read back as JS numbers. On the pinned `drizzle-orm@0.31.2`, a Postgres `numeric` column always reads back as `string`. `numeric({ mode: 'number' })` first shipped in `drizzle-orm@0.41.0` (checked against the published type definitions: 0.39 and 0.40 have no `PgNumericNumberBuilder`, 0.41 does). The pin is from June 2024, 14 minor versions behind the current stable `0.45.x`. Doing the bump as its own change keeps any drizzle-kit surprise separate from the column-type migration that follows.

## What Changes

- Bump `drizzle-orm` 0.31.2 → **0.45.3** and `drizzle-kit` 0.22.1 → **0.31.11** in `packages/database/package.json`, both pinned exactly. They're the matched pair released together on 2026-09-21. drizzle-kit has to move with drizzle-orm because each refuses to run against a mismatched version of the other.
- Confirm that drizzle-kit 0.31.11 reads the 7 committed v7 snapshots, and that `drizzle-kit generate` on the unchanged schema emits **no migration**. CI's `migrate` job runs `npm run db:generate` right before `npm run db:migrate` on `main`. A spurious diff there would be generated and applied to prod without review.
- Move the schema off the APIs deprecated in 0.35/0.36: `pgTable`'s third argument returns an array instead of an object, and `drizzle({ client, schema })` replaces `drizzle(client, { schema })`. Neither changes the generated SQL.
- No change to column types, data, queries or runtime behavior.

## Capabilities

### New Capabilities

- `database-toolchain`: Which Drizzle versions the repo pins, the requirement that the ORM and kit move together, and the guarantee that `db:generate` on an unchanged schema produces no migration. CI relies on that guarantee because it generates and migrates on `main`.

### Modified Capabilities

<!-- None: no existing spec covers the database toolchain. -->

## Impact

- Code: `packages/database/package.json`, `package-lock.json`, `packages/database/src/schema/listing.ts` (third-argument shape), `packages/database/src/client.ts` (`drizzle({ client })`). Possibly `drizzle/meta/*_snapshot.json`, if drizzle-kit rewrites snapshot metadata without changing SQL.
- Consumers: `backend` (transaction, insert, `onConflictDoNothing`, `returning`) and `frontend/src/server/routers/listing.ts` (`db.query.listings.findMany`, relational queries v1). Both APIs exist unchanged in 0.45. Every package must still type-check, build, test and lint.
- Breaking changes between 0.31 and 0.45, checked against this repo: 0.33 (postgres-js jsonb) doesn't apply because there are no jsonb columns. 0.34 is Turso-only. 0.35/0.36 are deprecations only. 0.38 renamed internal builder types the repo doesn't use. 0.41 removed driver mapping for array types the repo doesn't use.
- Database: none. No migration is added.
- Followed by `validate-scraped-listings`, which depends on this change.
- Out of scope: drizzle-orm 1.0 (still in release candidates), relational queries v2, `drizzle-zod`, and upgrading `postgres` (3.4.4 satisfies `>=3`).
