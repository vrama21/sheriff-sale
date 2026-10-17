## Why

Once the scraper can parse listings again (`fix-scraper-db-pipeline`, `adapt-scraper-to-civilview`), the listing schema still doesn't fit the data, and nothing stops duplicates. Checked against the live site, the Drizzle schema and prod on 2026-10-17:

- **The Drizzle schema doesn't fit the site's values.** It declares `propertyId` as `integer`, but all 691 property IDs sampled across 6 counties are around 2,195,000,000, past `integer`'s 2,147,483,647. It declares `sheriffId` as `integer`, but the site shows values like `F-23001318`. It caps the free-text columns at `varchar(256)`, but descriptions run 2,950–3,260 characters and plaintiffs reach 124. Any database built from the Drizzle migrations (such as local docker) rejects these values.
- **Prod's schema came from Prisma, not from Drizzle.** Every `Listing` column is already `text`, including `propertyId` and `sheriffId`, and the largest stored `propertyId` is 1,401,543,355. So prod hasn't hit an int4 overflow. But `propertyId` is stored as text, so it has no numeric type and no unique key.
- **Nothing stops duplicate listings.** There's no unique constraint on `propertyId`, and `saveListing` does find-then-insert, so two concurrent saves of the same listing both insert. Prod holds 759 duplicated `propertyId`s across 1,644 rows. 700 of those groups are within a single county: re-run copies from 2023-01 and 2024-03 whose fields carry a leading `\r `. The other 59 are Gloucester+Passaic pairs: Passaic's county ID was Gloucester's (`19`) from 2023 until `adapt-scraper-to-civilview`, so every row labelled Passaic is really a Gloucester listing (349 rows).
- **A listing and its status history aren't written atomically.** If a status-history insert fails, the listing stays without history permanently, because writes are insert-only and later runs skip it.
- **The status-history insert's `onConflictDoNothing()` does nothing.** No unique constraint exists for it to act on.

## What Changes

- **BREAKING (schema)**: `Listing.propertyId` becomes `bigint` with a unique index. In prod this converts the existing `text` column with `USING "propertyId"::bigint`. `Listing.sheriffId` and the scraped free-text columns (`address`, `attorney`, `courtCase`, `deed`, `deedAddress`, `defendant`, `description`, `judgment`, `parcel`, `plaintiff`, `priors`, `upsetAmount`) become `text` in the Drizzle schema. They're already `text` in prod, so those statements change nothing there.
- A data-repair migration runs before the unique index: it relabels every `county = 'Passaic'` row to `Gloucester`, then removes duplicate listings per `propertyId`, keeping the oldest row, and deletes the removed rows' status histories.
- `saveListing` inserts the listing with `ON CONFLICT ("propertyId") DO NOTHING`, which replaces find-then-insert, and writes the listing and all of its status-history rows in one transaction with one multi-row history insert.
- Remove the no-op `onConflictDoNothing()` from the status-history insert.

## Capabilities

### New Capabilities

- `listing-storage`: How scraped listings and their status histories are stored. Covers column types that fit the site's values, one row per `propertyId`, atomic writes, and the one-time repair of duplicate and mislabelled listings.

### Modified Capabilities

<!-- None: no existing spec covers listing storage. -->

## Impact

- Code: `packages/database/src/schema/listing.ts`, new migrations under `packages/database/drizzle/`, `backend/src/controllers/newJerseySheriffSaleScraper.ts` (`saveListing`) and its tests. `ListingParse` picks up `sheriffId: string` from the inferred `Listing` type.
- Database: in prod, `propertyId` changes from `text` to `bigint` and gains a unique index, and a data repair deletes 885 duplicate listings and their 717 status histories. That leaves 7,071 listings, one per `propertyId`. CI's `migrate` job runs migrations on `main` before `deploy-backend`, so the schema is in place before the Lambda that depends on it.
- Frontend: imports the `Listing` type. `sheriffId` changes from `number | null` to `string | null`; it must still type-check.
- Builds on `fix-scraper-db-pipeline` (the `saveListing` split). Runs alongside `adapt-scraper-to-civilview`; both are needed before any listing is written.
- Out of scope: updating existing listings (insert-only stays), a foreign key from `StatusHistory.listingId`, backfilling old integer `sheriffId` values to the site's `F-…` format, and reconciling the rest of prod's Prisma-era drift. Prod has NOT NULL on `Listing.address`, `county`, `plaintiff`, `propertyId`, `saleDate`, `sheriffId` and `state`, and on `StatusHistory.date` and `status`, while Drizzle types them all as nullable.
