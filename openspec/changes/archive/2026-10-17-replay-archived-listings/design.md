## Context

The daily scraper (EventBridge → Lambda, `backend/src/handlers/newJerseySheriffSaleScraperHandler.ts`) fetches each county's listings page and each listing's details page from salesweb.civilview.com. It archives both to the `nj-sheriff-sale` bucket, parses the details page, and inserts the listing (`saveListing` in `backend/src/controllers/newJerseySheriffSaleScraper.ts`) unless a row with the same `propertyId` exists. Nothing reads the archive back.

The archive and the database were measured read-only on 2026-10-17:

```
s3://nj-sheriff-sale/
  county-html-files/<YYYY-MM-DD>/<slug>-county.html          11,615 objects, 2024-07-02 → today
  listing-html-files/<YYYY-MM-DD>/property-id-<id>.html      35,900 objects, 2024-07-01 → today
      29,180  home page (session bug before #19: the redirect was followed and archived)
       2,250  legacy layout   2024-07-01 → 2025-02-25   <table> of heading-bold label cells + table#longTable
       4,470  current layout  2025-02-26 → today        .sale-detail-item + table#longTable
```

- **Property IDs are per search.** 35,892 of the 35,900 detail pages have a `propertyId` that appears nowhere else. The monotonically increasing IDs (1.3 billion in 2024-07, 2.2 billion now) are search-result handles, not sale IDs.
- **The sheriff number is stable within a county.** The 6,720 real pages cover 1,539 sheriff numbers, 749 of them on several days (up to 74). In prod, 6,938 rows with a sheriff number collapse to 3,619 `(county, sheriffId)` keys once whitespace is removed, in 2,174 duplicate groups. Only 17 keys show more than one address, and those are edits of the same property (`Absecon NJ` → `Absecon (Galloway Twp.) NJ`). 133 rows have a blank sheriff number.
- **County pages index the detail pages.** On a sample of 17 days, all 221 real detail pages were listed on one of that day's county pages. The only overlap was `gloucester` + `passaic` (both fetched with ID 19 before #19).
- **Status tables are edited in place.** Across 5,141 consecutive snapshot pairs of the same sale, 193 rows kept the status and changed the date, and 6 rows vanished.
- **Formats vary.** Sheriff numbers: `F-24000056`, `F-0102`, `20058093`, `FR-…`, `FOR-…`, `CH-…`, with `\r ` and trailing padding in prod. Status dates: `M/D/YYYY`, `MM/DD/YYYY` and `MM/DD/YYYY hh:mm PM`.
- **Prod has drifted from the Drizzle schema.** `Listing.county`, `StatusHistory.status` and `date` are NOT NULL in prod; Drizzle declares them nullable, and `status` as `varchar(256)` where prod has `text`. No `StatusHistory` row is orphaned. Prod's last insert was 2024-10-23.
- **#22 changed prod while this was implemented.** Its `0007` stripped `\r` and trimmed text fields, stored blank sheriff numbers as NULL (133 rows) and deleted 2 status rows with invalid dates (dated 3021). Its `0008` made `StatusHistory.date` and `Listing.saleDate` `date` columns (any time of day dropped) and the money columns numeric. Prod now has 8,251 status rows, all dates, and no whitespace left in any sheriff number.

Merged, unarchived changes this builds on: `fix-scraper-db-pipeline` (#18: limiter, per-listing isolation, county failure rules), `listing-schema-fixes` (#17: `propertyId` unique, atomic insert), `adapt-scraper-to-civilview` (#19: current parsers, per-county sessions, raw archive), `backfill-listing-addresses` (#20), `upgrade-drizzle` (#21: drizzle-orm 0.45.3, drizzle-kit 0.31.11) and `validate-scraped-listings` (#22: `listingSchema.ts` validates and coerces every parsed page, typed money and date columns, nullable `sheriffId`).

## Goals / Non-Goals

**Goals:**

- Every real archived page reaches the database through the same parse-and-sync path as the daily scrape.
- One row per sale, with fields from its newest snapshot and a status history that keeps every row the site ever showed, with when it was shown.
- Re-running over pages already synced writes nothing. Pages can be replayed in any order and give the same result.
- Junk and unreadable pages never change data.

**Non-Goals:**

- A work queue, a replay Lambda, or any infrastructure change. The replay is a local command.
- Re-fetching from the live site.
- Matching a sale across counties, or across sheriff-number format changes (`F-0102` vs `F-24000102`).
- Repairing the 133 rows without a sheriff number.
- Frontend changes. It will be reworked; status dates change format underneath it.
- Field-level history for listings (only status rows keep history).

## Decisions

### 1. Identity: `(county, sheriffId)`, with a unique index that NULLs never match

`sheriffId` is stored with all whitespace removed, and a blank one as NULL (#22 already stores it that way). `Listing_county_sheriffId_key` is a plain unique index on `(county, sheriffId)`: Postgres never treats two NULLs as equal in it, so rows without a sheriff number aren't held to it and need no partial `WHERE`. `Listing_propertyId_key` is dropped. `propertyId` stays as the ID of the snapshot the fields came from.

- The upsert targets that index with `onConflictDoUpdate({ target: [county, sheriffId], set, setWhere })` (drizzle-orm 0.45.3).
- A snapshot without a sheriff number is skipped, not inserted. A NULL never conflicts, so inserting it would create a row nothing could ever match again.
- _Alternative:_ a partial index `WHERE "sheriffId" <> ''` over `NOT NULL` sheriff numbers, as first planned. #22 made the column nullable and blank values NULL, which a plain index already handles.
- _Alternative:_ a separate `listingKey` column (`county|sheriffId`). That's one more derived value to keep in sync; the two existing columns already say it.
- _Alternative:_ match on court case number. Court case is also stable, but 19 keys show two court-case spellings, and the sheriff number is what the site shows first.

### 2. One shared sync path

```
            live scrape                                  replay
  GET county page ─▶ archive                read archived county page
  parse ids                                 parse ids
  GET detail ─▶ archive                     read archived detail page
        │                                          │
        └──────────────┬───────────────────────────┘
                       ▼
          parseListingSnapshot(html)          detect layout → current | legacy | unrecognised; raw text
                       ▼
          buildListingSnapshot(county, propertyId, snapshotDate)
                                              validate (listingSchema), cleanAddress,
                                              normalize sheriffId and status, hash; + field warnings
                       ▼
          syncListing(snapshot)  ── one transaction ──▶ upsert Listing, merge StatusHistory
                       ▼
          'inserted' | 'updated' | 'unchanged' + { statusInserted, statusExtended }
```

`scrapeListing` and `saveListing` become thin wrappers (or are replaced) so the Lambda and the replay call the same `parseListingSnapshot` and `syncListing`. The live scrape's snapshot date is the UTC date `saveHtmlToS3` uses for the archive key, so a live write and a later replay of the same page carry the same date.

### 3. Listing upsert: hash plus snapshot-date guard, in one statement

```sql
INSERT INTO "Listing" (...) VALUES (...)
ON CONFLICT ("county", "sheriffId")
DO UPDATE SET <fields> = excluded.<fields>, "propertyId" = excluded."propertyId",
              "contentHash" = excluded."contentHash", "snapshotDate" = excluded."snapshotDate", "updatedAt" = now()
WHERE "Listing"."contentHash" IS DISTINCT FROM excluded."contentHash"
  AND ("Listing"."snapshotDate" IS NULL OR excluded."snapshotDate" >= "Listing"."snapshotDate")
RETURNING "id", (xmax = 0) AS "inserted"
```

- When the `WHERE` fails, Postgres returns no row. The sync then selects the row's `id` by `(county, sheriffId)` to merge status rows, and reports "unchanged". `xmax = 0` tells an insert from an update.
- `contentHash` is SHA-256 (Node `crypto`) of the JSON of the validated listing fields in a fixed key order, excluding `propertyId`, `snapshotDate`, `contentHash`, `id` and timestamps. The snapshot sets every field `listingSchema` and `cleanAddress` produce (null where the page has none), plus county and state; `latitude`, `longitude` and `mapsUrl` aren't scraped, so the update never touches them. Excluding `propertyId` matters: it changes on every search, so including it would make every snapshot look changed.
- Order independence: an older snapshot never overwrites a newer one. Snapshots replayed in any order converge to the newest snapshot's fields.
- A newer snapshot with identical fields doesn't advance `snapshotDate`. That keeps the "write only on change" rule, and nothing depends on `snapshotDate` being the latest observation. Status rows' `lastSeenOn` records that instead.
- _Alternative:_ compare fields column by column in SQL. A hash is one comparison, and new fields join it automatically.

### 4. Status history: union with first/last-seen dates

`StatusHistory` gains `firstSeenOn date` and `lastSeenOn date`, and a unique index `StatusHistory_listingId_status_date_key` on `(listingId, status, date)`. For each row on a snapshot:

```sql
INSERT INTO "StatusHistory" ("listingId", "status", "date", "firstSeenOn", "lastSeenOn")
VALUES (...)                                    -- all of the snapshot's rows, one statement
ON CONFLICT ("listingId", "status", "date") DO UPDATE
SET "firstSeenOn" = LEAST("StatusHistory"."firstSeenOn", excluded."firstSeenOn"),
    "lastSeenOn"  = GREATEST("StatusHistory"."lastSeenOn", excluded."lastSeenOn"),
    "updatedAt"   = now()
WHERE excluded."firstSeenOn" < "StatusHistory"."firstSeenOn"
   OR excluded."lastSeenOn"  > "StatusHistory"."lastSeenOn"
RETURNING (xmax = 0) AS "inserted"
```

- `LEAST`/`GREATEST` make the merge commutative and idempotent, so replay order doesn't matter and a re-run updates nothing.
- Status rows are merged even when the listing write is skipped by the guard. An older snapshot can still contribute rows the site later edited, and it moves `firstSeenOn` earlier.
- A listing's current rows are those whose `lastSeenOn` equals the listing's greatest `lastSeenOn`. Rows with an earlier `lastSeenOn` were edited or dropped on the site. This is a reading rule for consumers; nothing stores a "current" flag.
- The two `date` columns are `date` type and NOT NULL after the repair migration backfills them.
- _Alternatives considered with the user:_ pure union (keeps 193 edited rows as indistinguishable stale duplicates) and "latest snapshot wins" (loses history and the 6 dropped rows). Union with seen dates keeps everything and lets readers tell current from stale.

### 5. Normalization lives in one TypeScript module and is mirrored once in SQL; dates come from #22

`normalizeSheriffId` removes all whitespace and turns a blank result into NULL. `normalizeStatus` collapses whitespace runs and trims. Status dates need no rule of this change's own: `listingSchema`'s `validateStatusHistory` (#22) turns `M/D/YYYY`, with or without a time, into `YYYY-MM-DD` with `toIsoDate`, and skips a row with an empty status or no valid date (2000 to five years ahead) with a field warning. `StatusHistory.date` stays a `date` column.

The repair migration has to produce exactly the same values for existing rows, or replayed rows won't dedupe against them. It implements the sheriff-number and status rules with `regexp_replace`, using JavaScript's `\s` set spelled out. Stored dates already went through #22's `0008`, which used the same `M/D/YYYY` rule, so the repair leaves them alone.

- A consequence of dates without a time: two rows of one sale with the same status on the same day at different times are one row. The archive shows times only on some counties' pages, and #22 already dropped them from stored rows.
- _Alternative:_ keep `date` as text, with `YYYY-MM-DD HH:mm` when the site gives a time, as first planned. That would undo #22's `date` column and its readers; dropped when rebasing onto #22.

### 6. Replay selects through county pages, not a bucket listing

For each date (ascending) and county: read `county-html-files/<date>/<slug>-county.html`, parse property IDs with `parseCountyProperyIds`, read `listing-html-files/<date>/property-id-<id>.html`, then parse and sync.

- Detail keys carry no county, and the county is part of the identity. The county page is the only place the archive says which county a detail page belongs to. It also handles the pre-#19 `passaic` page by mapping it to Gloucester (Decision 7).
- No `ListBucket` needed: keys are built, and S3 reports a missing key as `NoSuchKey` to a caller with list permission. That includes the local admin profile. A missing key is counted, not failed. Any other S3 error (including `AccessDenied`, which a caller without list permission gets for a missing key) is counted as a failed read, so a wrong profile shows up as failures rather than silently as "missing".
- Reads go through the existing process-wide `s3` client with a new `getS3Text` helper that returns the body as a string, or `undefined` for `NoSuchKey`.
- Concurrency: the existing `createConcurrencyLimiter`, with a cap of 8 on detail pages in flight. The database client has `max: 1`, so syncs serialize anyway. That's fine for about 6,700 real pages.
- _Alternative:_ list `listing-html-files/<date>/` and assign counties by parsing addresses. The address doesn't say the county reliably, and listing needs `ListBucket`.
- The county pages also point at the 29k junk pages, because the session bug archived a home page under each listed property ID. Layout detection (Decision 8) filters those out.

### 7. Passaic before the fix is Gloucester

`PASSAIC_ID_FIX_DATE = '2026-10-17'`. Until #19's deploy, the scraper fetched Passaic with Gloucester's ID 19, so `passaic-county.html` dated on or before that date lists Gloucester sales (and #17's `0004` already relabelled those DB rows). The daily run on 2026-10-17 ran at 00:00 UTC, before #19 merged at 06:46 UTC, so that date is still pre-fix. Replaying Gloucester on those dates reads both slugs; replaying Passaic on those dates selects nothing and says so.

### 8. Layout detection and the legacy parser

`detectListingLayout(html)` returns `current` when `.sale-detail-item` exists, `legacy` when a `td.heading-bold` exists, and `unrecognised` otherwise. A `parseListingSnapshot(html)` dispatcher picks the details parser. Both layouts use `table#longTable` for status, so the current `parseStatusHistory` reads both.

`parseLegacyListingDetails` reads each `td.heading-bold` label cell and its next `td` sibling, strips the trailing colon, maps the label with `cleanPropertyKey`, and extracts the value with the same `<br>`-aware text helper as `parseListingDetails` (moved to a shared helper), so `cleanAddress` gets the street and city on separate lines. Like `parseListingDetails` since #22, it returns raw text keyed by field name, and `listingSchema` validates both layouts the same way (dropping an unknown label with a warning). Labels were checked on archived legacy pages: `Sheriff #:`, `Court Case #:`, `Sales Date:`, `Plaintiff:`, `Defendant:`, `Address:`, `Description:`, `Approx. Upset*:` / `Upset Amount:`, `Approx. Judgment*:` / `Approx Judgment*:`, `Priors:`, `Deed:`, `Deed Address:`, `Attorney:`. All of them map to listing fields.

Pages archived before #19 were entity-decoded with `he.decode` before saving, so text like `&amp;` became `&` in the file. Parsing them decodes again, which only matters for text that contained a literal entity after the first decode (rare in these fields). Accepted.

### 9. Repair migration for existing rows

These run after #22's `0007_normalize_listing_values` and `0008_peaceful_omega_flight`, in order, inside one `npm run db:migrate` run (Drizzle's migrator wraps all pending migrations in one transaction):

1. **Generated** (`0009_bitter_juggernaut`): add `Listing.snapshotDate date`, `Listing.contentHash text`, `StatusHistory.firstSeenOn date`, `StatusHistory.lastSeenOn date` (nullable for now); drop `Listing_propertyId_key`; align the Drizzle schema with prod (NOT NULL on `Listing.county`, `StatusHistory.date` and `status`, and `status` as `text`). The schema file gets the new unique indexes only in step 3, so this generation doesn't emit them.
2. **Custom** (`0010_repair_listing_identity`): remove whitespace from sheriff numbers, storing a blank one as NULL; collapse and trim status text; backfill `snapshotDate`, `firstSeenOn` and `lastSeenOn` from each listing's `createdAt::date`; for each duplicate `(county, sheriffId)` group with a sheriff number, re-point status rows to the newest row (latest `createdAt`, then highest `id`) and delete the others; then collapse duplicate `(listingId, status, date)` status rows into the lowest `id`, with `MIN(firstSeenOn)` and `MAX(lastSeenOn)`. Rows without a sheriff number keep their status rows but aren't merged.
3. **Generated** (`0011_fluffy_vampiro`): add the two unique indexes and set NOT NULL on `firstSeenOn` and `lastSeenOn`.

`contentHash` stays NULL on existing rows, so the first replay of a newer snapshot updates them (`IS DISTINCT FROM NULL`) and stamps a hash. Existing rows were scraped with the old parser and old `cleanAddress`, so refreshing them from newer snapshots is wanted.

- The newest row survives because the old writes were insert-only, so the newest row is the newest snapshot. #17's `0004` kept the oldest per `propertyId` for a different reason (clean re-run copies); here every row in a group has a different `propertyId`.
- A read-only `inspect_listing_identity.sql` next to the migrations shows the groups, survivors and status-row moves before merge, like #17's `inspect_listing_duplicates.sql`.

## Risks / Trade-offs

- [SQL and TypeScript normalizers disagree, so replayed rows don't dedupe against migrated ones] → Both implement the same sheriff-number and status rules, and dates are compared as dates. A test compares the status rule over prod's distinct values on a local Postgres before merge.
- [The merge deletes about 3,300 prod rows] → It runs in the migration transaction, so a failure rolls back. Take a Railway backup (or a `pg_dump` of `Listing` and `StatusHistory`) before merging the PR. Review `inspect_listing_identity.sql` output in the PR.
- [A sheriff number legitimately reused within a county for different sales] → Not seen: the 17 multi-address keys are edits of the same property. If it happens, the two sales merge, and their status rows stay distinguishable by date.
- [Junk pages that parse] → The home page has neither `.sale-detail-item` nor `td.heading-bold`. A page that has the layout but no sheriff number is skipped. Neither can write.
- [Long replay against prod from a laptop] → About 6,700 real pages and roughly 29k junk GETs; the junk is small and skipped after one parse. Idempotency means an interrupted run is simply re-run. `--dry-run` sizes a range first.
- [An orphaned status row, or any NULL left by the seen-date backfill, makes `0011`'s NOT NULL fail] → The whole run rolls back, `0010` included. Prod has none (checked read-only).
- [`snapshotDate` lags the latest observation for unchanged listings] → By design (write only on change). `MAX(lastSeenOn)` gives the latest observation.

## Migration Plan

1. Merge with CI: the `migrate` job runs `0009`–`0011` in one transaction, then `deploy-backend` ships the Lambda with the upsert. Take a DB backup first.
2. After deploy, the next daily run syncs the live site and reports inserted, updated and unchanged per county.
3. Run `npm run replay:archive -- --from 2024-07-01 --to <yesterday> --dry-run` locally, review the counts against the Context numbers, then run it without `--dry-run`.
4. Run it again over the same range and confirm the summary shows zero writes.
5. Spot-check a sale with many snapshots (one of the 74-snapshot sheriff numbers): one row, status rows with sensible first and last seen dates.

Rollback: restore the backup. The code rollback alone isn't enough, because the old insert relies on `Listing_propertyId_key`, which the migration drops.

## Open Questions

- None blocking. (Resolved with the user: union plus seen dates; parcel data out of scope; no queue; replay by county and date range over every snapshot; legacy pages in scope.)
