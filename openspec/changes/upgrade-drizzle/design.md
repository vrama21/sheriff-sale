## Context

`packages/database` pins `drizzle-orm@0.31.2` and `drizzle-kit@0.22.1` (June 2024). The repo uses only a small part of Drizzle:

| Where | API |
|---|---|
| `packages/database/src/client.ts` | `drizzle(sql, { schema })` on `postgres-js` |
| `packages/database/src/migrate.ts` | `drizzle-orm/postgres-js/migrator` |
| `schema/listing.ts`, `schema/statusHistory.ts` | `pgTable`, `relations`, `uniqueIndex`, column builders, `$inferSelect` / `$inferInsert` |
| `backend/src/controllers/newJerseySheriffSaleScraper.ts` | `db.transaction`, `insert`, `onConflictDoNothing({ target })`, `returning` |
| `frontend/src/server/routers/listing.ts` | `db.query.listings.findMany` (RQB v1) |

The migrations folder holds `0000`–`0006`, and all 7 snapshots are format `"version": "7"`. Prod has `0004`–`0006` applied (`drizzle.__drizzle_migrations` ids 9–11). CI's `migrate` job runs `npm run db:generate && npm run db:migrate` on `main`. So whatever `generate` emits in CI is applied to prod without review.

**`.env` at the repo root points at prod.** `drizzle.config.ts`, `client.ts` and `migrate.ts` all load it.

## Goals / Non-Goals

**Goals:**
- `drizzle-orm` ≥ 0.41 so that `numeric({ mode: 'number' })` is available to `validate-scraped-listings`.
- The upgrade adds no migration, changes no SQL, and changes no runtime behavior.
- Remove the deprecation warnings that would otherwise show up in the next change's diff.

**Non-Goals:**
- drizzle-orm 1.0 (still in release candidates), RQB v2, `drizzle-zod`.
- Any change to column types or data.
- Upgrading `postgres` (3.4.4 satisfies 0.45's `postgres >=3` peer range).

## Decisions

### 1. Target `drizzle-orm@0.45.3` + `drizzle-kit@0.31.11`, pinned exactly

Both were published on 2026-09-21 as a matched release. The newer `drizzle-orm@0.45.4` (2026-10-08) has no matching kit release and is under two weeks old.
- *Alternative: 0.41.0, the minimum.* That release is older than 0.45 and has no kit pair as recent. Both releases would involve the same breaking-change review, so there's no reason to stop early.
- *Alternative: 1.0 RC.* It changes the snapshot format and RQB, and it isn't stable.

### 2. The no-op `generate` is the acceptance gate, not just a check

After the bump, with no schema edits, run `DATABASE_URL=postgres://localhost/unused npm run db:generate`. It must report no changes. If it emits a migration, the cause is a kit diffing or serialization change (column defaults, index or constraint naming, `IF NOT EXISTS`). **Don't commit that migration.** Find the cause, then do one of two things:
- the snapshot metadata changes only cosmetically (drizzle-kit rewriting `_snapshot.json` fields without new SQL): commit the rewritten snapshots;
- a real SQL diff appears: stop and report it. That's a schema drift question for the user, not something to paper over.

`drizzle-kit 0.22.1` previously exited 0 while printing "Run drizzle-kit up" (see `listing-schema-fixes` task 2.2). So also confirm that the new kit actually diffs: its output must not contain that prompt.

### 3. Adopt the non-deprecated APIs in the same change

- `pgTable(name, cols, (t) => ({ propertyIdKey: uniqueIndex(...) }))` → `(t) => [uniqueIndex('Listing_propertyId_key').on(t.propertyId)]`. The index name is explicit, so the generated SQL is identical, and Decision 2's no-op check verifies that.
- `drizzle(sql, { schema })` → `drizzle({ client: sql, schema })`.

These are done here so that `validate-scraped-listings`' schema diff shows only the column-type change.

## Risks / Trade-offs

- [Kit emits a spurious migration that CI would apply] → Decision 2 makes the no-op `generate` the gate. The PR must show no new files under `drizzle/`.
- [Something running locally connects to prod through `.env`] → Never run `db:migrate`, `db:push`, `db:studio` or `db:pull`. Run `generate` with a dummy `DATABASE_URL`, which overrides `.env` because dotenv doesn't overwrite variables that are already set.
- [Type-level changes in 0.38+ break `ListingParse` / `StatusHistoryParse` (`Omit<Listing, ...>`)] → They're built on `$inferSelect`, which is stable. The type-check across all workspaces catches it if not.
- [Frontend RQB v1 behavior shift] → `findMany({ where: (t, { eq }) => ... })` is unchanged in 0.45. The frontend type-check and build cover it.
- [drizzle-kit can't find drizzle-orm ("Please install latest version of drizzle-orm")] → The kit resolves `drizzle-orm` from its own install location. npm always nests `drizzle-orm` in `packages/database/node_modules`, because its optional peers (`expo-sqlite`, `op-sqlite` → `react-native`) want React 19 while the root has the frontend's React 18. drizzle-kit 0.31 doesn't depend on `drizzle-orm`, so a plain `npm install` hoists it to the root, where it can't see the ORM. The lockfile pins `drizzle-kit` at `packages/database/node_modules/drizzle-kit`, next to the ORM, as 0.22.1 already was. `npm install` and `npm ci` keep that placement, but regenerating the lockfile from scratch would undo it. If that happens, `db:generate` (and therefore `prebuild`) fails loudly instead of silently.
- [`tsup` bundling of `packages/database` changes with the new ESM layout] → `npm run build` at the root, which builds `packages/database/dist`, must pass, and the backend `esbuild` bundle must build.

## Migration Plan

No database migration. Deploying is a normal merge to `main`: CI's `generate` produces nothing, `migrate` applies nothing new, and the backend and frontend redeploy on the new ORM. Rollback: revert the commit.

## Open Questions

- None.
