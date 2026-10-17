**Safety, for every task:** the repo's `.env` `DATABASE_URL` points at **prod**, and `client.ts`, `migrate.ts`, `drizzle.config.ts` and `docker-compose.yml` all load it. Never run `db:migrate`, `db:push`, `db:studio`, the scraper, `replay:archive` (with or without `--dry-run`), or anything else that connects with that URL. `drizzle-kit generate` doesn't connect. Read-only prod queries go only through `.claude/skills/db-query/scripts/query.sh --env prod`. A database for testing is a throwaway container on a non-default port with an explicit URL (task 7.2), never the compose service. Never write to S3.

## 1. Schema

_Revised after rebasing onto #21 (drizzle-orm 0.45.3) and #22 (validate-scraped-listings), which merged while this change was implemented. With the user: `StatusHistory.date` stays #22's `date` column, and `sheriffId` stays nullable with a blank one stored as NULL._

- [x] 1.1 In `packages/database/src/schema/listing.ts`: add `snapshotDate: date('snapshotDate', { mode: 'string' })` and `contentHash: text('contentHash')`, remove `Listing_propertyId_key`, and make `county` `.notNull()` to match prod. Leave `sheriffId` nullable (#22). Don't add the new unique index yet (task 2.3).
- [x] 1.2 In `packages/database/src/schema/statusHistory.ts`: make `date` (a `date` column since #22) `.notNull()` and `status` `text('status').notNull()` to match prod, and add `firstSeenOn` and `lastSeenOn` as `date(..., { mode: 'string' })`, nullable for now.
- [x] 1.3 Check the frontend and backend type-check with the stricter types (`npm run build` in `backend/` and `packages/database/`, and the frontend type-check). Fix only what these changes break.
  - Done: the only break outside code this change replaces was `StatusHistoryParse`, which now also omits `firstSeenOn` and `lastSeenOn` (the parser doesn't produce them; the sync sets them).

## 2. Migrations (design Decision 9)

- [x] 2.1 Run `npm run db:generate` in `packages/database` (with `DATABASE_URL=postgres://localhost/unused`) for tasks 1.1–1.2. Check that the SQL adds the four columns, drops `Listing_propertyId_key`, sets the NOT NULLs and `status`'s type, and doesn't drop or recreate any column. Quote identifiers by hand if drizzle-kit leaves them unquoted.
  - Done: `0009_bitter_juggernaut.sql`, after #22's `0007` and `0008`. drizzle-kit 0.31.11 quoted every identifier. The NOT NULL and type changes are no-ops on prod, which already has them.
- [x] 2.2 Generate the custom migration (`npx drizzle-kit generate --custom --name repair_listing_identity`) and write its SQL in this order:
  - Remove all whitespace from `"Listing"."sheriffId"`, storing a blank result as NULL.
  - Collapse whitespace in `"StatusHistory"."status"` and trim it. Dates need nothing: #22's `0008` made them dates with the same `M/D/YYYY` rule the scraper uses.
  - Set `"Listing"."snapshotDate" = "createdAt"::date`, and each status row's `firstSeenOn` and `lastSeenOn` to its listing's `"createdAt"::date`.
  - For each `("county", "sheriffId")` with `"sheriffId" IS NOT NULL` and more than one row, re-point status rows to the survivor (latest `"createdAt"`, then highest `"id"`), then delete the other listings.
  - Collapse status rows sharing `("listingId", "status", "date")` into the one with the lowest `"id"`, giving it `MIN("firstSeenOn")` and `MAX("lastSeenOn")`, and delete the rest.
  - Add a header comment explaining why, like `0004`.
  - Done: `0010_repair_listing_identity.sql`. Whitespace is JavaScript's `\s` set spelled out with `\uXXXX` escapes, so it matches `normalize.ts` exactly; each normalizing update touches only rows whose value changes. Prod has no NULL `createdAt` and no orphaned status rows (checked read-only), so the seen-date backfill leaves no NULLs for `0011`'s NOT NULL.
- [x] 2.3 Add `uniqueIndex('Listing_county_sheriffId_key').on(table.county, table.sheriffId)` to `listings`, and `uniqueIndex('StatusHistory_listingId_status_date_key').on(listingId, status, date)` plus `.notNull()` on `firstSeenOn` and `lastSeenOn` to `statusHistories`, in drizzle 0.45's array form. Run `npm run db:generate` again. Check the new migration orders after 2.2 in `drizzle/meta/_journal.json`, has both indexes and the NOT NULLs, and quotes identifiers.
  - Done: `0011_fluffy_vampiro.sql`, fully quoted. The index on `(county, sheriffId)` is a plain unique index: NULL sheriff numbers never conflict in it, so it needs no partial `WHERE` (the first plan's `WHERE "sheriffId" <> ''` assumed a NOT NULL column).
- [x] 2.4 Run `npm run db:generate` once more and confirm it reports no changes.
  - Done: "No schema changes, nothing to migrate".
- [x] 2.5 Add `packages/database/drizzle/inspect_listing_identity.sql` (outside the journal) with read-only queries: duplicate `(county, normalized sheriffId)` groups and rows to delete, rows without a sheriff number, status rows to move and to collapse, and the range of status dates. Run it with `db-query --env prod` (read-only) and record the counts as done notes.
  - Done (prod, read-only, 2026-10-17, after #22): 2,174 duplicate groups holding 5,493 rows; 3,319 listings to delete, leaving 3,619 with a sheriff number; 133 without one (NULL). Status rows: 8,251 in total, 4,379 to move, 2,946 to collapse, leaving 5,305. Status dates run from 2014-12-12 to 2025-10-29. Before #22 the same checks found 8,253 status rows in five `M/D/YYYY` text shapes; #22 deleted the 2 dated 3021.

## 3. Normalization and snapshot building (backend)

- [x] 3.1 Add `backend/src/services/listingSync/normalize.ts` with `normalizeSheriffId` (whitespace removed, blank to null) and `normalizeStatus` (whitespace collapsed, trimmed), per spec "Status history is merged across snapshots" and design Decision 5. Status dates come from #22's `toIsoDate` through `validateStatusHistory`. Unit-test both, including `\r` padding, NBSP and blank values.
  - Done. The first implementation also had a `normalizeStatusDate` producing `YYYY-MM-DD HH:mm`; it was removed when rebasing onto #22.
- [x] 3.2 Add `contentHash(listing)`: SHA-256 hex of the JSON of the listing's fields in sorted key order, excluding `propertyId`, `snapshotDate`, `contentHash`, `id`, `createdAt` and `updatedAt`. Test that it ignores `propertyId` and changes when any field changes.
- [x] 3.3 Define a `ListingSnapshot` type (`listing` fields, `statusHistory`, `snapshotDate`, `contentHash`) and `buildListingSnapshot({ page, county, propertyId, snapshotDate })`. It validates the page's raw text with #22's `validateListingDetails` and `validateStatusHistory`, applies `cleanAddress`, normalizes the sheriff number and status rows, drops status rows that are the same once normalized, computes the hash, and returns `{ snapshot, warnings }`.
  - Done: `buildListingSnapshot.ts`. The snapshot's `listing` always has every field `listingSchema` and `cleanAddress` produce (`SNAPSHOT_FIELDS`), typed as #22 types them (money as numbers, `saleDate` as `YYYY-MM-DD`), with `null` where the page has none, so an update clears a field the site dropped. `latitude`, `longitude` and `mapsUrl` aren't scraped, so they're left out and a sync never overwrites them. It throws when `listingSchema` rejects the page (no address).

## 4. Parsers and layout detection

- [x] 4.1 Move `parseListingDetails`' `textWithLineBreaks` and `cleanValue` into a shared helper module, with no change in behavior. The existing tests must still pass.
  - Done: `cleanValue` is exported from `detailValueText.ts`, and `textWithLineBreaks` stays private to it.
- [x] 4.2 Add `parseLegacyListingDetails` per spec "Legacy details parsing": read each `td.heading-bold` label cell and its next `td`, strip the trailing colon, map with `cleanPropertyKey`, and keep `<br>` as a line break in the address. Return raw text keyed by field name, like `parseListingDetails` since #22, for `listingSchema` to validate. Throw `Legacy listing details layout not recognised` when there are no label cells.
  - Done. Both legacy fixtures pass `validateListingDetails` with no warnings, so every legacy label maps to a known field.
- [x] 4.3 Add `detectListingLayout(html): 'current' | 'legacy' | 'unrecognised'` and `parseListingSnapshot(html)`, which dispatches to the right details parser plus `parseStatusHistory`, and returns `{ layout: 'unrecognised' }` without throwing for unrecognised pages.
- [x] 4.4 Add sanitized fixtures from real archived pages under `__fixtures__/`: one legacy page (2024) and one legacy page with `Approximate Judgment`. Reuse `home.html` for the unrecognised case. Replace defendant and plaintiff names with placeholders. Fetch them read-only (`aws s3 cp s3://nj-sheriff-sale/listing-html-files/<date>/property-id-<id>.html -`); find candidates with a `heading-bold` grep on 2024 keys. Test both parsers and detection, including the spec's legacy-page scenario through `cleanAddress`.
  - Done: `listingDetailsLegacySalem.html` (2024-07-02, property 1319120858, the spec's `F-24000056` page) and `listingDetailsLegacyCumberland.html` (2024-10-02, with `Approx. Judgment*`, `Upset Amount`, `Priors`, `Deed`, `Deed Address`, and an address wrapped in a maps link). Party, attorney and notice text are replaced with placeholders. The real label is `Approx. Judgment*` (also `Approx Judgment*`), not `Approximate Judgment`, and both map to `judgment`. The spec's example page is listed on Salem's county page and headed "Salem County"; the spec scenario calls it Gloucester only as an illustration. A sample of 79 real 2024 pages plus 4 from 2025 all detected and parsed correctly.

## 5. Listing sync

- [x] 5.1 Add `syncListing(snapshot)` per design Decisions 3 and 4, in one `db.transaction`:
  - Upsert the listing with `onConflictDoUpdate({ target: [listings.county, listings.sheriffId], set, setWhere })`.
  - Return `id` and whether it was an insert (`xmax = 0`). On no row, select the `id` by `(county, sheriffId)`.
  - Merge all status rows in one multi-row insert with `onConflictDoUpdate` using `LEAST`/`GREATEST` and the `setWhere` guard, returning per-row insert or update.
  - Resolve `{ listing: 'inserted' | 'updated' | 'unchanged', statusInserted, statusExtended }`.
  - Reject snapshots without a sheriff number (NULL) before the transaction.
  - Done: `backend/src/services/listingSync/syncListing.ts`. The backend has no `drizzle-orm` dependency of its own, so `@sheriff-sale/database` now re-exports `and`, `eq` and drizzle's `sql`. The last is exported as `drizzleSql`, because `sql` is already the package's postgres.js client and an explicit re-export would silently shadow it. The update sets only `SNAPSHOT_FIELDS`, `propertyId`, `contentHash`, `snapshotDate` and `updatedAt`. See 7.2 for the check against a throwaway Postgres.
- [x] 5.2 Unit-test `syncListing` with `@sheriff-sale/database` mocked, in the style of `newJerseySheriffSaleScraper.test.ts`: the insert, update and unchanged outcomes; status rows merged on "unchanged"; a status failure rejecting; and a missing sheriff number never opening a transaction.
- [x] 5.3 Switch the live scraper to the shared path. `scrapeListing` fetches the HTML and calls `parseListingSnapshot` and `buildListingSnapshot` with the snapshot date `saveHtmlToS3` uses (export a `todaysArchiveDate()` helper from `saveHtmlToS3.ts` rather than computing it twice). An unrecognised layout becomes a per-listing failure, as now. `saveListing` calls `syncListing`. `CountyParseSummary` replaces `inserted` with `inserted`, `updated` and `unchanged`, and the log line and the "every database write fails" rule keep working.
  - Done: `scrapeListing` resolves `{ snapshot, warnings }`, keeping #22's field warnings (tagged with county and property ID, logged with `console.warn` and summed as `fieldWarnings`). It rejects an unrecognised layout, a page `listingSchema` rejects, and a page without a sheriff number, so each counts as a failed listing rather than a failed write (the spec's "skipped"). `syncListing` rejects a missing sheriff number too, as a backstop. `saveListing` resolves the `ListingSyncResult`. `CountyParseSummary` has `inserted`, `updated`, `unchanged`, `failedWrites` and `fieldWarnings`.
- [x] 5.4 Update `newJerseySheriffSaleScraper.test.ts` and the handler test for the new summary and write path. Keep the isolation, limiter and county-rule tests passing, and #22's field-warning tests.

## 6. Replay command

- [x] 6.1 Add `getS3Text({ bucketName, key }): Promise<string | undefined>` in `backend/src/services/s3/`, returning `undefined` only for `NoSuchKey` and rethrowing everything else. Test with the S3 client mocked.
- [x] 6.2 Add `backend/scripts/replayArchive/args.ts`, parsing `--county` (repeatable; matches `NJ_COUNTIES` case-insensitively), `--from`, `--to` and `--dry-run`. It rejects unknown counties, malformed dates and reversed ranges, and expands the date list ascending. Test it.
- [x] 6.3 Add `plan.ts`: for a date and a requested county, return the county-page keys and the county label to sync under, per spec "Passaic pages before the county-ID fix are Gloucester" (`PASSAIC_ID_FIX_DATE = '2026-10-17'`). Use the slug rule from `getCountyListingsHtml`. Test the Gloucester, pre-fix Passaic and post-fix Passaic cases, and `cape-may`.
  - Done: the slug rule is now `countySlug()` in `services/newJerseySheriffSale/countySlug.ts`, used by both `getCountyListingsHtml` and the plan. Before the fix, Gloucester's two pages are deduplicated by property ID.
- [x] 6.4 Add `replay.ts`, with the S3 reader and `syncListing` injected so it's testable. For each date, then each county: read the county page(s), parse property IDs, read each detail page through `createConcurrencyLimiter(8)`, call `parseListingSnapshot` and `buildListingSnapshot`, and unless `--dry-run`, call `syncListing`. Count every outcome in spec "Run summary and failures". Log failures with their key, and never stop the run for one page.
  - Done: county pages that fail to read or to parse are counted together as `countyPagesFailed`. The summary also counts `parsed` (snapshots ready to sync), so a dry run shows what a real run would sync, and `fieldWarnings`, each also logged with its key. The run fails (non-zero exit) on any failed county-page or detail-page read, or any failed sync; parse failures, unrecognised pages and pages without a sheriff number are only counted.
- [x] 6.5 Add `index.ts` (usage comment like `backfillListingAddresses/index.ts`): load env with `dotenv`, run, print the per-county and total summary, `await sql.end()`, and exit non-zero on any failed read or sync. Add `"replay:archive": "ts-node scripts/replayArchive/index.ts"` to `backend/package.json`. Make sure `--dry-run` never calls `syncListing`. Import the database client lazily, so a dry run doesn't open a DB connection.
  - Done: `replay.ts` imports `buildListingSnapshot` and the parsers by file path, and `syncListing` only as a type, so nothing it loads reaches `@sheriff-sale/database`. `index.ts` imports `@sheriff-sale/database` and `syncListing` with `import()` only when it isn't a dry run. Checked by loading `index.ts`'s static imports (no database, postgres or drizzle module is loaded), and by a jest mock in `replay.test.ts` that throws if the database package is ever loaded.
- [x] 6.6 Test `replay.ts` end to end with an in-memory S3 map and a fake `syncListing` covering:
  - a county page listing a current-layout page, a legacy page, the home page and a missing key;
  - a missing county page;
  - pre-fix Gloucester reading both slugs;
  - a sync failure giving a non-zero result;
  - `--dry-run` making no sync calls;
  - a second run against a fake that reports "unchanged" summarizing zero writes;
  - a field warning counted and logged without stopping the sync.

## 7. Verification

- [x] 7.1 Run `npm run build`, `npm test` and `npm run lint` in `backend/`; `npm run build` and `npm run lint` in `packages/database/`; and the frontend's type-check and lint. Fix any failures.
  - Done, after rebasing onto #21 and #22: everything passes. Backend: 24 suites, 279 tests. The database build's prebuild `db:generate` reports no schema changes. Frontend lint shows only two existing warnings, in files this change doesn't touch.
- [x] 7.2 Check the migrations against a throwaway database on a non-default port with an explicit URL (never the `.env` value): apply migrations through #22's `0008`, seed duplicate listings and padded, blank and NULL sheriff numbers, apply `0009`–`0011`, and confirm the repair outcomes in spec "Repair of existing listings" and that a failure rolls the whole run back. Run `syncListing` against it. Then confirm `0010`'s SQL and `normalize.ts` give identical values for prod's distinct statuses (exported read-only) and the archive's. Remove the database afterwards.
  - Done without Docker (its daemon wasn't running): a throwaway Homebrew Postgres 18.3 cluster in the session scratchpad on port 55432, since stopped and deleted. Prod runs 15.5.
    - Repair: 14 padded Atlantic copies became one row with each status row once (seen 2024-03-13); a sale scraped on two days kept its newer row, holding both rows' status rows with first/last seen dates; a `createdAt` tie kept the highest `id`; one sheriff number in two counties stayed two listings; NULL and whitespace-only Bergen sheriff numbers stayed, as NULL, alongside each other under the unique index, with their status rows normalized. Both unique indexes exist.
    - Rollback: an orphaned status row makes `0011`'s `SET NOT NULL` fail, and the whole run rolled back, `0009` and `0010` included.
    - `syncListing` (drizzle-orm 0.45.3): insert, update, unchanged on re-sync, unchanged when only `propertyId` differs, an older snapshot (unchanged, `firstSeenOn` moved earlier), an edited status date kept as a second row, two counties sharing a sheriff number, and a missing sheriff number rejected.
    - Normalizers: `0010`'s sheriff-number and status updates matched `normalize.ts` on all 174 statuses (prod's 90 distinct, every status in 85 sampled archive pages, and whitespace edge cases including NBSP, U+2028 and U+FEFF) and 7 sheriff numbers: 0 mismatches. Dates aren't compared: #22 stores them as dates on both paths.
- [x] 7.3 Run `openspec validate replay-archived-listings --strict` and fix any issues.
  - Done: "Change 'replay-archived-listings' is valid".
- [x] 7.4 Leave the prod run to the user: DB backup, merge (CI migrates), `replay:archive --dry-run`, the real run, and the zero-write re-run, per the design's Migration Plan. Don't run any of it.
  - Done (left for you): none of it was run.
