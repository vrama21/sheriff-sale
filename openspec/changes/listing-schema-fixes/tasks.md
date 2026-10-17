## 1. Schema

- [x] 1.1 In `packages/database/src/schema/listing.ts`, change `propertyId` to `bigint('propertyId', { mode: 'number' })` with `uniqueIndex('Listing_propertyId_key')`, and change `sheriffId` and the free-text columns listed in design Decision 1 to `text`. Leave the derived columns and `StatusHistory` as they are.

## 2. Migrations

**Never run `db:migrate`, `db:push` or `db:studio`, or anything else that connects to a database.** `drizzle.config.ts`, `client.ts` and `migrate.ts` load the repo's `.env`, which points at prod. `drizzle-kit generate` doesn't connect, but it needs `DATABASE_URL` set to start: use a dummy value (`DATABASE_URL=postgres://localhost/unused`) if none is set.

- [x] 2.1 Generate the custom repair migration first (`npx drizzle-kit generate --custom --name repair_listing_duplicates` in `packages/database`) and write its SQL per design Decision 2: relabel Passaic → Gloucester, then delete status histories and listings ranked below first per `propertyId` (`ORDER BY "createdAt" NULLS LAST, id`).
- [x] 2.2 Generate the schema migration (`npm run db:generate`) for task 1.1. Check that it orders after the repair migration in `drizzle/meta/_journal.json`, that it contains the type changes and the unique index, and that it doesn't drop or recreate columns.
  - _Done notes:_ the committed snapshots were format v5, which drizzle-kit 0.22.1 refuses to diff (it prints "Run drizzle-kit up" and exits 0, so CI's `db:generate` was a silent no-op). `drizzle-kit up` upgraded `0000`–`0003_snapshot.json` to v7 offline; the SQL files and journal entries are unchanged. drizzle-kit also emitted the index column unquoted (`btree (propertyId)`, which Postgres folds to `propertyid`); `0005_slim_magneto.sql` quotes it by hand.
- [x] 2.3 Add `packages/database/drizzle/inspect_listing_duplicates.sql` (outside the migration journal) with the read-only queries from the Migration Plan: Passaic row count, duplicate `propertyId` groups, rows the repair would delete, and `max("propertyId")`. Don't run it.
- [x] 2.4 Run `npm run db:generate` again and confirm it reports no schema changes, so CI won't generate an unreviewed migration.

## 3. saveListing

- [x] 3.1 Rewrite `saveListing` in `backend/src/controllers/newJerseySheriffSaleScraper.ts` per design Decision 3: one `db.transaction`, listing insert with `onConflictDoNothing({ target: listings.propertyId })` and `returning({ id })`, `false` when nothing comes back, and one multi-row status-history insert when there are rows. Remove the `findFirst` lookup and the no-op `onConflictDoNothing()` on the history insert. Remove the `as number` cast on `propertyId` if the types allow it.
- [x] 3.2 Update `newJerseySheriffSaleScraper.test.ts` (`@sheriff-sale/database` mocked): a conflict returns `false` and writes no history; a new listing inserts the listing and its histories inside the transaction callback in one statement; a listing with no history skips the history insert; a failing history insert rejects the save. Keep the existing isolation and county-rule tests passing.

## 4. Verification

- [x] 4.1 Run `npm run build`, `npm test` and `npm run lint` in `backend/`; `npm run build` and `npm run lint` in `packages/database/`; and the frontend's type-check and lint (`frontend/`), since `Listing.sheriffId` changes type. Fix any failures. Don't run the scraper locally or invoke the Lambda.
- [x] 4.2 Run `openspec validate listing-schema-fixes --strict` and fix any issues.
