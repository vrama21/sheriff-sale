## Context

The schema lives in `packages/database/src/schema/` (Drizzle 0.31, postgres.js with `max: 1`). Migrations are generated with drizzle-kit into `packages/database/drizzle/` and applied by `src/migrate.ts`. On `main`, CI's `migrate` job runs `npm run db:generate` and then `npm run db:migrate` against prod (`DATABASE_URL` from repo secrets) before `deploy-backend` and `deploy-frontend`. The Drizzle Postgres migrator applies all pending migrations in one transaction.

After `fix-scraper-db-pipeline` (#18), `saveListing` in `backend/src/controllers/newJerseySheriffSaleScraper.ts`:

1. looks the listing up by `propertyId`, and returns `false` if found;
2. in a transaction, inserts the listing and reads its id back;
3. inserts each status-history row separately, each with a no-op `.onConflictDoNothing()`.

Prod's schema doesn't match the Drizzle files (checked read-only on 2026-10-17). The tables were created by Prisma (`_prisma_migrations` exists), and Drizzle's `0000` is `CREATE TABLE IF NOT EXISTS`, so it never shaped them. Every `Listing` and `StatusHistory` column is `text`, including `propertyId` and `sheriffId`, and several are NOT NULL that Drizzle treats as nullable. `drizzle.__drizzle_migrations` records `0000`–`0003` as applied.

The values the site serves today (verified on 2026-10-17): property IDs around 2.195 × 10⁹; sheriff numbers like `F-23001318`; descriptions around 3,000 characters; plaintiffs up to at least 124 characters. Passaic was mapped to county ID 19 (Gloucester's) from the first backend commit in 2023 until `adapt-scraper-to-civilview` fixed it.

## Goals / Non-Goals

**Goals:**

- Every value the site serves today fits its column.
- One `Listing` row per `propertyId`, enforced by the database rather than a check in code.
- A listing and its status histories are written together or not at all.
- Existing duplicate and mislabelled rows are repaired in the same rollout, so the unique index can be created.

**Non-Goals:**

- Updating listings that already exist, or appending new status rows to them. The unique index on `propertyId` makes a later upsert possible, but this change keeps insert-only behavior.
- A foreign key from `StatusHistory.listingId` to `Listing.id`. Prod had no orphan rows on 2026-10-17, but adding one is a separate decision.
- Reconciling prod's other Prisma-era drift (NOT NULL columns Drizzle types as nullable).
- Rewriting old integer `sheriffId` values (`23001318`) into the site's current format (`F-23001318`).
- Changing `migrate.ts` (which loads `.env.local`) or `drizzle.config.ts` / `client.ts` (which load `.env`).

## Decisions

### 1. Column types

- `propertyId`: `bigint('propertyId', { mode: 'number' })`. Values up to 2⁵³ stay exact as JS numbers, so `ListingParse.propertyId` stays `number`. Add `uniqueIndex('Listing_propertyId_key').on(table.propertyId)` in the table's extra-config callback. Prod's column is `text`, which Postgres won't convert to `bigint` implicitly, so `0005` uses `USING "propertyId"::bigint`. All 7,071 distinct stored values are plain digits, and they stay distinct after the cast. Postgres treats NULLs as distinct, so a missing `propertyId` doesn't conflict, although the scraper always sets one.
- `sheriffId`: `text`. Prod is already `text`; a database built from the Drizzle migrations converts its integers to their text form.
- `address`, `attorney`, `courtCase`, `deed`, `deedAddress`, `defendant`, `description`, `judgment`, `parcel`, `plaintiff`, `priors`, `upsetAmount`: `text`. These are copied from public notices with no natural length limit, and `text` costs the same as `varchar` in Postgres.
- Columns the scraper derives itself stay as they are: `city`, `street`, `unit`, `secondaryUnit`, `zipcode`, `state`, `county`, `saleDate`, `attorneyPhone`, `latitude`, `longitude`, `mapsUrl`. So does `StatusHistory`.
- _Alternative:_ larger `varchar` limits. These would just move the failure to the next long notice.

### 2. Data repair runs first, in the same migration run

Two migrations, in this order:

1. A custom migration (`drizzle-kit generate --custom --name repair_listing_duplicates`) that:
   - sets `county = 'Gloucester'` where `county = 'Passaic'`. Every such row came from a Gloucester scrape (ID 19), and no real Passaic listing could have been stored before the ID fix;
   - ranks listings per non-null `propertyId` by `"createdAt" NULLS LAST, id`, deletes the `StatusHistory` rows of every listing ranked below first, then deletes those listings.
2. The generated migration for the Decision 1 schema changes, including the unique index.

Because the Drizzle migrator applies pending migrations in one transaction, a failure anywhere (for example, the index still finding duplicates) rolls everything back and fails CI's `migrate` job before deploy.

- _Why keep the oldest:_ every duplicate group is the same listing stored more than once, created within hours of each other. Most groups (700 of 759) are re-run copies from 2023-01 and 2024-03, and the later copy's fields carry a leading `\r `. The other 59 are the same Gloucester page stored under two labels. Keeping the oldest keeps the clean copy, and the id any earlier reference would use.
- _Alternative:_ a manual one-off script. It's easy to forget, and a missed run blocks the index migration. Putting it in the migration chain makes the order impossible to get wrong.

### 3. Insert with `ON CONFLICT DO NOTHING`, in one transaction

```ts
return db.transaction(async (tx) => {
  const [newListing] = await tx
    .insert(listings)
    .values(parsedListing)
    .onConflictDoNothing({ target: listings.propertyId })
    .returning({ id: listings.id });

  if (!newListing) return false; // already stored

  if (parsedStatusHistories.length > 0) {
    await tx.insert(statusHistories).values(parsedStatusHistories.map((h) => ({ ...h, listingId: newListing.id })));
  }

  return true;
});
```

- This replaces the `findFirst` lookup: the unique index answers "already stored?" atomically, so concurrent saves of the same listing can't both insert.
- One multi-row status-history insert replaces N parallel inserts. A failure rolls back the listing too, so the next run tries the whole listing again instead of skipping a listing with no history.
- `saveListing` keeps returning `true` (inserted) or `false` (already stored), so the controller's summary counts don't change.
- With postgres.js `max: 1`, a transaction holds the only connection and other saves wait for it. Each transaction is two statements, so that's acceptable. Raising `max` is a separate decision.

### 4. Deploy order

CI applies migrations before deploying the Lambda. Code that uses `onConflictDoNothing({ target: listings.propertyId })` needs the unique index to exist, or Postgres rejects the statement ("no unique or exclusion constraint matching the ON CONFLICT specification"). Ship the schema and the `saveListing` change in the same merge to `main`; CI orders them correctly.

## Risks / Trade-offs

- [The repair deletes rows in prod] → It deletes only rows that share a `propertyId` with an older row, plus those rows' status histories: 885 listings and 717 status histories as of 2026-10-17. Re-run the read-only inspection queries in task 2.3 just before merging, and compare.
- [Type changes rewrite the `Listing` table under a lock] → In prod only `propertyId` changes type (the `text` → `text` statements are no-ops). The table holds 7,956 rows, so the rewrite takes seconds. The daily scraper runs at 00:00 UTC; avoid merging near then.
- [Old rows keep integer-style `sheriffId` values while new rows use `F-…`] → Accepted (Non-Goals). Both are plain text now.
- [The Drizzle snapshots describe the Drizzle schema, not prod] → drizzle-kit can't see prod's Prisma-era types or NOT NULLs, so generated SQL can assume types prod doesn't have. `0005`'s `USING` cast is hand-written for that reason. Reconciling the snapshots with prod is out of scope.
- [The CI `migrate` job runs `db:generate` before `db:migrate`] → If the committed snapshot doesn't match the schema, CI would generate an unreviewed migration. Task 2.4 checks that `db:generate` reports no changes after the migrations are committed.

## Migration Plan

1. Before merging, run the inspection queries (task 2.3) read-only against prod and record the counts. On 2026-10-17: 349 Passaic rows; 759 duplicate groups holding 1,644 rows; 885 listings and 717 status histories to delete; `max("propertyId")` 1,401,543,355.
2. Merge to `main`. CI applies both migrations in one transaction, then deploys the Lambda.
3. After the next scheduled run, check that `Inserted Listing` lines appear (assuming `adapt-scraper-to-civilview` has also landed), and that `SELECT "propertyId", count(*) FROM "Listing" GROUP BY 1 HAVING count(*) > 1` returns nothing.

Rollback: the type widening is safe to leave in place. If the code has to go back, redeploy the previous Lambda; the old find-then-insert code still runs on the new columns. Deleted duplicates aren't restored; they were copies.

## Open Questions

- None blocking.
