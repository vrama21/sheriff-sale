## Why

Once the scraper can parse listings again (`fix-scraper-db-pipeline`, `adapt-scraper-to-civilview`), the database still rejects every one. Checked against the live site and the schema on 2026-10-17:

- **`propertyId` overflows `integer`.** All 691 property IDs sampled across 6 counties are around 2,195,000,000, and Postgres `integer` tops out at 2,147,483,647. The lookup `WHERE "propertyId" = $1` errors before any insert runs. IDs crossing 2³¹ may be what stopped writes around November 2024.
- **`sheriffId` is `integer`, but the site shows values like `F-23001318`.**
- **`description` is `varchar(256)`, but real descriptions run 2,950–3,260 characters.** Plaintiff values already reach 124 characters, and the other free-text columns are capped at 256 too.
- **Nothing stops duplicate listings.** There's no unique constraint on `propertyId`, and `saveListing` does find-then-insert, so two concurrent saves of the same listing both insert. That has already happened: Passaic's county ID was Gloucester's (`19`) from 2023 until `adapt-scraper-to-civilview`, so every run scraped Gloucester twice, in parallel, under two labels. Every row labelled Passaic is really a Gloucester listing.
- **A listing and its status history aren't written atomically.** If a status-history insert fails, the listing stays without history permanently, because writes are insert-only and later runs skip it.
- **The status-history insert's `onConflictDoNothing()` does nothing.** No unique constraint exists for it to act on.

## What Changes

- **BREAKING (schema)**: `Listing.propertyId` becomes `bigint` with a unique index. `Listing.sheriffId` and the scraped free-text columns (`address`, `attorney`, `courtCase`, `deed`, `deedAddress`, `defendant`, `description`, `judgment`, `parcel`, `plaintiff`, `priors`, `upsetAmount`) become `text`.
- A data-repair migration runs before the unique index: it relabels every `county = 'Passaic'` row to `Gloucester`, then removes duplicate listings per `propertyId`, keeping the oldest row, and deletes the removed rows' status histories.
- `saveListing` inserts the listing with `ON CONFLICT ("propertyId") DO NOTHING`, which replaces find-then-insert, and writes the listing and all of its status-history rows in one transaction with one multi-row history insert.
- Remove the no-op `onConflictDoNothing()` from the status-history insert.

## Capabilities

### New Capabilities

- `listing-storage`: How scraped listings and their status histories are stored. Covers column types that fit the site's values, one row per `propertyId`, atomic writes, and the one-time repair of the Passaic/Gloucester duplicates.

### Modified Capabilities

<!-- None: no existing spec covers listing storage. -->

## Impact

- Code: `packages/database/src/schema/listing.ts`, new migrations under `packages/database/drizzle/`, `backend/src/controllers/newJerseySheriffSaleScraper.ts` (`saveListing`) and its tests. `ListingParse` picks up `sheriffId: string` from the inferred `Listing` type.
- Database: column type changes and a unique index on the prod `Listing` table, plus a data repair that deletes duplicate rows. CI's `migrate` job runs migrations on `main` before `deploy-backend`, so the schema is in place before the Lambda that depends on it.
- Frontend: imports the `Listing` type. `sheriffId` changes from `number | null` to `string | null`; it must still type-check.
- Builds on `fix-scraper-db-pipeline` (the `saveListing` split). Runs alongside `adapt-scraper-to-civilview`; both are needed before any listing is written.
- Out of scope: updating existing listings (insert-only stays), a foreign key from `StatusHistory.listingId`, and backfilling old integer `sheriffId` values to the site's `F-…` format.
