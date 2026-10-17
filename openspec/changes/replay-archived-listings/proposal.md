## Why

The S3 archive holds every listing page the scraper has fetched since 2024-07-01, but nothing ever reads it, and the database can't use it as-is. Checked read-only against the archive and prod on 2026-10-17:

- **The database stopped growing two years ago.** Prod's last `Listing` insert was 2024-10-23. The archive has 6,720 real detail pages, 4,470 of them from after that date, that never reached the database.
- **`propertyId` doesn't identify a sale.** The site assigns a new `propertyId` to every search result: 35,892 of the 35,900 archived detail pages have a `propertyId` seen nowhere else. A sale keeps its `Sheriff #` within its county, so prod's 6,938 rows with a sheriff number hold only 3,619 distinct `(county, sheriffId)` sales. Because #17's unique index is on `propertyId`, every re-scrape of a sale inserts another row.
- **Writes are insert-only, so a sale's status history is frozen at whichever copy was inserted.** Each detail page shows the status table as it stood that day. Across 5,141 consecutive pairs of snapshots of the same sale, 193 rows kept their status but had their date changed (`ADJOURNED SHERIFF | 4/10/2025` → `| 3/27/2025`), and 6 disappeared. The full history exists only across the daily snapshots.
- **Most of the archive is junk, and two layouts are mixed in.** 29,180 detail pages (81%) are the site's home page, saved under a property-ID key by the session bug #19 fixed. Real pages use the old table layout until 2025-02-25 (2,250 pages) and the `sale-detail-item` layout from 2025-02-26 (4,470 pages). The current parser reads only the new layout.

## What Changes

- **BREAKING (schema)**: A listing is identified by `(county, sheriffId)`, with the sheriff number's whitespace removed, instead of `propertyId`. A blank sheriff number is stored as NULL, as #22 already does. The unique index moves to those columns; NULLs never conflict in it, so listings without a sheriff number aren't held to it. `propertyId` stays, holding the most recent site ID. Its unique index is dropped.
- **BREAKING (data)**: A migration merges existing duplicate listings into one row per `(county, sheriffId)`. The most recently created row survives, and the other rows' status histories move to it. 2,174 duplicate groups in prod; 133 rows without a sheriff number (NULL since #22) are left alone.
- Listing writes become an upsert. A listing's parsed fields are hashed; the stored row is updated only when the hash differs **and** the snapshot is at least as new as the one the row came from. Each listing records its `snapshotDate` and `contentHash`.
- Status history becomes a union across snapshots. Status text is normalized, and dates are the `YYYY-MM-DD` dates #22's listing validation produces (the time of day is dropped, and rows without a valid date are skipped with a field warning). Each `(listingId, status, date)` is stored once, and each row records the first and last snapshot dates that showed it (`firstSeenOn`, `lastSeenOn`). Nothing is deleted. A listing's current rows are the ones with its latest `lastSeenOn`.
- The daily scraper and the replay share one write path, built on #22's listing validation: a page is parsed, validated and coerced (`listingSchema`), turned into a snapshot, and synced. The live scrape also stops being insert-only. Both count field warnings.
- Add a local replay command: `npm run replay:archive -- --county <name>... --from <date> --to <date> [--dry-run]`. For each date (ascending) and county, it reads that day's archived county page, takes its property IDs, and processes each archived detail page from that day.
- Detect each page's layout: the current parser for `sale-detail-item` pages, a legacy details parser for old-layout pages, and skip and log anything else (home pages, missing pages, pages without a sheriff number) without writing.
- Archived pages listed under `passaic` on or before 2026-10-17 are recorded as Gloucester, since Passaic used Gloucester's county ID until #19.
- Re-running the replay over a range it has already processed writes nothing.

## Capabilities

### New Capabilities

- `listing-sync`: How a parsed listing snapshot reaches the database. Covers listing identity by county and sheriff number, change detection and the snapshot-date guard, status-history merging with first/last-seen dates, normalization, the repair of existing duplicate rows, and the daily scrape using the same path.
- `archive-replay`: How archived HTML is selected and replayed. Covers the replay command and its options, county pages as the per-day index, the Passaic relabel, layout detection with current and legacy parsers, skipping unusable pages, dry runs, and the run summary.

### Modified Capabilities

<!-- None in openspec/specs/. This change supersedes listing-schema-fixes' "One listing per property ID" requirement (listing-storage) and its insert-only write, but that change isn't archived yet, so there's no main spec to delta against. Reconcile listing-storage when listing-schema-fixes is archived. -->

## Impact

- Code: `backend/src/controllers/newJerseySheriffSaleScraper.ts` (shared snapshot processing, upsert in `saveListing`), a legacy details parser and layout detection in `backend/src/services/newJerseySheriffSale/`, an S3 read helper that reports a missing key, and a new replay command under `backend/scripts/replayArchive/` with a `replay:archive` npm script.
- Database: `Listing` gains `snapshotDate` and `contentHash`, its unique index moves from `propertyId` to `(county, sheriffId)`. `StatusHistory` gains `firstSeenOn` and `lastSeenOn` and a unique index on `(listingId, status, date)`. A data migration normalizes sheriff numbers and status text, merges duplicate listings and deletes the merged-away rows. The Drizzle schema is also brought in line with prod for `Listing.county`, `StatusHistory.date` and `status` (NOT NULL, `status` as text). The migrations follow #22's `0007` and `0008`.
- Operations: the replay runs locally with an AWS profile that can read `nj-sheriff-sale` and a writable `DATABASE_URL`. No infrastructure changes, no queue, and no new Lambda permissions.
- Frontend: not changed (it will be reworked). Status dates were already made dates by #22.
- Builds on #21 (drizzle-orm 0.45.3, drizzle-kit 0.31.11) and #22 (validate-scraped-listings: Zod validation in `listingSchema.ts`, numeric money columns, date columns, nullable `sheriffId`), both merged while this change was implemented.
- Out of scope: NJ parcel or tax data, an SQS work queue, re-fetching anything from the live site, and deduplicating sales across counties.
