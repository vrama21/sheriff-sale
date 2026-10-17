**Safety, for every task:** the repo's `.env` `DATABASE_URL` points at **prod**, and `client.ts`, `migrate.ts`, `drizzle.config.ts` and `docker-compose.yml` all load it. Never run `db:migrate`, `db:push`, `db:studio`, the scraper, `replay:archive` (with or without `--dry-run`), or anything else that connects with that URL. `drizzle-kit generate` doesn't connect. Read-only prod queries go only through `.claude/skills/db-query/scripts/query.sh --env prod`. A database for testing is a throwaway container on a non-default port with an explicit URL (task 7.2), never the compose service. Never write to S3.

## 1. Schema

- [x] 1.1 In `packages/database/src/schema/listing.ts`: add `snapshotDate: date('snapshotDate', { mode: 'string' })` and `contentHash: text('contentHash')`, remove `Listing_propertyId_key`, and make `sheriffId` and `county` `.notNull()` to match prod. Don't add the new unique index yet (task 2.3).
- [x] 1.2 In `packages/database/src/schema/statusHistory.ts`: change `date` to `text('date').notNull()`, make `status` `text('status').notNull()` to match prod, and add `firstSeenOn` and `lastSeenOn` as `date(..., { mode: 'string' })`, nullable for now.
- [x] 1.3 Check the frontend and backend type-check with the stricter types (`npm run build` in `backend/` and `packages/database/`, and the frontend type-check). Fix only what these changes break.
  - Done: backend, database and frontend type-check clean. The only break was `StatusHistoryParse`, which now also omits `firstSeenOn` and `lastSeenOn` (the parser doesn't produce them; the sync sets them).

## 2. Migrations (design Decision 9)

- [x] 2.1 Run `npm run db:generate` in `packages/database` (with `DATABASE_URL=postgres://localhost/unused` if needed) for tasks 1.1–1.2. Check that the SQL adds the four columns, drops `Listing_propertyId_key`, sets the types and NOT NULLs, and doesn't drop or recreate any column. Quote identifiers by hand if drizzle-kit leaves them unquoted (it did in `0005`).
  - Done: `0007_material_cammi.sql`. Every identifier is quoted. The type/NOT NULL changes are no-ops on prod, which already has them.
- [ ] 2.2 Generate the custom migration (`npx drizzle-kit generate --custom --name repair_listing_identity`) and write its SQL in this order:
  - Remove all whitespace from `"Listing"."sheriffId"`.
  - Normalize `"StatusHistory"."status"` (collapse whitespace, trim) and `"date"` per design Decision 5: rewrite only values matching `M/D/YYYY` → `YYYY-MM-DD` or `M/D/YYYY h:mm AM|PM` → `YYYY-MM-DD HH24:MI`, and collapse and trim the rest.
  - Set `"Listing"."snapshotDate" = "createdAt"::date`, and each status row's `firstSeenOn` and `lastSeenOn` to its listing's `"createdAt"::date`.
  - For each `("county", "sheriffId")` with `"sheriffId" <> ''` and more than one row, re-point status rows to the survivor (latest `"createdAt"`, then highest `"id"`), then delete the other listings.
  - Collapse status rows sharing `("listingId", "status", "date")` into the one with the lowest `"id"`, giving it `MIN("firstSeenOn")` and `MAX("lastSeenOn")`, and delete the rest.
  - Add a header comment explaining why, like `0004`.
- [ ] 2.3 Add `uniqueIndex('Listing_county_sheriffId_key').on(table.county, table.sheriffId).where(sql\`"sheriffId" <> ''\`)` to `listings`, and `uniqueIndex('StatusHistory_listingId_status_date_key').on(listingId, status, date)` plus `.notNull()` on `firstSeenOn` and `lastSeenOn` to `statusHistories`. Run `npm run db:generate` again. Check the new migration orders after 2.2 in `drizzle/meta/_journal.json`, has both indexes (the partial one with its `WHERE`) and the NOT NULLs, and quotes identifiers.
- [ ] 2.4 Run `npm run db:generate` once more and confirm it reports no changes.
- [ ] 2.5 Add `packages/database/drizzle/inspect_listing_identity.sql` (outside the journal) with read-only queries: duplicate `(county, normalized sheriffId)` groups and rows to delete, blank-sheriff rows, status rows to move and to collapse, and the distinct status-date formats. Run it with `db-query --env prod` (read-only) and record the counts as done notes. Expect about 2,174 groups, about 3,300 rows to delete, and 133 blank.

## 3. Normalization and snapshot building (backend)

- [ ] 3.1 Add `backend/src/services/listingSync/normalize.ts` with `normalizeSheriffId`, `normalizeStatus` and `normalizeStatusDate` (Luxon), per spec "Status history is merged across snapshots" and design Decision 5. Write a unit test for each format seen in the archive (`9/7/2023`, `07/20/2023`, `10/07/2024 02:00 PM`, `12/30/2024 12:05 AM`, non-date text, `\r` padding).
- [ ] 3.2 Add `contentHash(listing)`: SHA-256 hex of the JSON of the listing's fields in sorted key order, excluding `propertyId`, `snapshotDate`, `contentHash`, `id`, `createdAt` and `updatedAt`. Test that it ignores `propertyId` and changes when any field changes.
- [ ] 3.3 Define a `ListingSnapshot` type (`listing` fields, `statusHistory`, `snapshotDate`, `contentHash`) and `buildListingSnapshot({ html-parse result, county, propertyId, snapshotDate })`. It applies `cleanAddress`, normalizes the sheriff number and status rows, drops exact duplicate status rows within the snapshot, and computes the hash.

## 4. Parsers and layout detection

- [ ] 4.1 Move `parseListingDetails`' `textWithLineBreaks` and `cleanValue` into a shared helper module, with no change in behavior. The existing tests must still pass.
- [ ] 4.2 Add `parseLegacyListingDetails` per spec "Legacy details parsing": read each `td.heading-bold` label cell and its next `td`, strip the trailing colon, map with `cleanPropertyKey`, and keep `<br>` as a line break in the address. Throw `Legacy listing details layout not recognised` when there are no label cells.
- [ ] 4.3 Add `detectListingLayout(html): 'current' | 'legacy' | 'unrecognised'` and `parseListingSnapshot(html)`, which dispatches to the right details parser plus `parseStatusHistory`, and returns `{ layout: 'unrecognised' }` without throwing for unrecognised pages.
- [ ] 4.4 Add sanitized fixtures from real archived pages under `__fixtures__/`: one legacy page (2024) and one legacy page with `Approximate Judgment`. Reuse `home.html` for the unrecognised case. Replace defendant and plaintiff names with placeholders. Fetch them read-only (`aws s3 cp s3://nj-sheriff-sale/listing-html-files/<date>/property-id-<id>.html -`); find candidates with a `heading-bold` grep on 2024 keys. Test both parsers and detection, including the spec's legacy-page scenario through `cleanAddress`.

## 5. Listing sync

- [ ] 5.1 Add `syncListing(snapshot)` per design Decisions 3 and 4, in one `db.transaction`:
  - Upsert the listing with `onConflictDoUpdate({ target: [listings.county, listings.sheriffId], targetWhere: sql\`"sheriffId" <> ''\`, set, setWhere })`.
  - Return `id` and whether it was an insert (`xmax = 0`). On no row, select the `id` by `(county, sheriffId)`.
  - Merge all status rows in one multi-row insert with `onConflictDoUpdate` using `LEAST`/`GREATEST` and the `setWhere` guard, returning per-row insert or update.
  - Resolve `{ listing: 'inserted' | 'updated' | 'unchanged', statusInserted, statusExtended }`.
  - Reject snapshots with a blank sheriff number before the transaction.
- [ ] 5.2 Unit-test `syncListing` with `@sheriff-sale/database` mocked, in the style of `newJerseySheriffSaleScraper.test.ts`: the insert, update and unchanged outcomes; status rows merged on "unchanged"; a status failure rejecting; and a blank sheriff number never opening a transaction.
- [ ] 5.3 Switch the live scraper to the shared path. `scrapeListing` fetches the HTML and calls `parseListingSnapshot` and `buildListingSnapshot` with the snapshot date `saveHtmlToS3` uses (export a `todaysArchiveDate()` helper from `saveHtmlToS3.ts` rather than computing it twice). An unrecognised layout becomes a per-listing failure, as now. `saveListing` calls `syncListing`. `CountyParseSummary` replaces `inserted` with `inserted`, `updated` and `unchanged`, and the log line and the "every database write fails" rule keep working.
- [ ] 5.4 Update `newJerseySheriffSaleScraper.test.ts` and the handler test for the new summary and write path. Keep the isolation, limiter and county-rule tests passing.

## 6. Replay command

- [ ] 6.1 Add `getS3Text({ bucketName, key }): Promise<string | undefined>` in `backend/src/services/s3/`, returning `undefined` only for `NoSuchKey` and rethrowing everything else. Test with the S3 client mocked.
- [ ] 6.2 Add `backend/scripts/replayArchive/args.ts`, parsing `--county` (repeatable; matches `NJ_COUNTIES` case-insensitively), `--from`, `--to` and `--dry-run`. It rejects unknown counties, malformed dates and reversed ranges, and expands the date list ascending. Test it.
- [ ] 6.3 Add `plan.ts`: for a date and a requested county, return the county-page keys and the county label to sync under, per spec "Passaic pages before the county-ID fix are Gloucester" (`PASSAIC_ID_FIX_DATE = '2026-10-17'`). Use the slug rule from `getCountyListingsHtml`. Test the Gloucester, pre-fix Passaic and post-fix Passaic cases, and `cape-may`.
- [ ] 6.4 Add `replay.ts`, with the S3 reader and `syncListing` injected so it's testable. For each date, then each county: read the county page(s), parse property IDs, read each detail page through `createConcurrencyLimiter(8)`, call `parseListingSnapshot` and `buildListingSnapshot`, and unless `--dry-run`, call `syncListing`. Count every outcome in spec "Run summary and failures". Log failures with their key, and never stop the run for one page.
- [ ] 6.5 Add `index.ts` (usage comment like `backfillListingAddresses/index.ts`): load env with `dotenv`, run, print the per-county and total summary, `await sql.end()`, and exit non-zero on any failed read or sync. Add `"replay:archive": "ts-node scripts/replayArchive/index.ts"` to `backend/package.json`. Make sure `--dry-run` never calls `syncListing`. Import the database client lazily, so a dry run doesn't open a DB connection.
- [ ] 6.6 Test `replay.ts` end to end with an in-memory S3 map and a fake `syncListing` covering:
  - a county page listing a current-layout page, a legacy page, the home page and a missing key;
  - a missing county page;
  - pre-fix Gloucester reading both slugs;
  - a sync failure giving a non-zero result;
  - `--dry-run` making no sync calls;
  - a second run against a fake that reports "unchanged" summarizing zero writes.

## 7. Verification

- [ ] 7.1 Run `npm run build`, `npm test` and `npm run lint` in `backend/`; `npm run build` and `npm run lint` in `packages/database/`; and the frontend's type-check and lint. Fix any failures.
- [ ] 7.2 If Docker is available, check the migrations against a throwaway database. Start one with `docker run --rm -d --name replay-verify -e POSTGRES_PASSWORD=verify -p 55432:5432 postgres:16`, apply migrations `0000`–latest with an explicit `DATABASE_URL=postgres://postgres:verify@localhost:55432/postgres` (never the `.env` value), seed duplicate listings and mixed-format status rows, and confirm the repair outcomes in spec "Repair of existing listings". Then export the distinct prod status-date values read-only (`db-query --env prod --json 'SELECT DISTINCT date FROM "StatusHistory"'`), and confirm the migration's SQL and `normalizeStatusDate` produce identical strings for all of them. Remove the container afterwards. If Docker isn't available, record that as a done note and leave it for the user.
- [ ] 7.3 Run `openspec validate replay-archived-listings --strict` and fix any issues.
- [ ] 7.4 Leave the prod run to the user: DB backup, merge (CI migrates), `replay:archive --dry-run`, the real run, and the zero-write re-run, per the design's Migration Plan. Don't run any of it.
