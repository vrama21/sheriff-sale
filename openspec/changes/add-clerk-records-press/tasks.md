## 1. Spike: PRESS behaviour (answers design Open Questions)

- [x] 1.1 For each of Essex, Passaic, Monmouth and Burlington, capture real pages into `modules/clerkRecords/__fixtures__/press/<county>/`, by hand or with a throwaway script and at most a handful of requests per county: the entry page, a name search for a known listing's defendant with doc type lis pendens, a page-2 postback, a block/lot search for that listing's parcel, and a no-records result
- [x] 1.2 Check whether a result row or "View Image" postback opens a document detail view. Record which fields it shows (party roles, consideration, cross-references to other instruments) and capture one detail fixture per county if one exists
- [x] 1.3 From the fixtures, record for each county: whether the defendant is the direct or indirect party on a lis pendens and the mortgagor on a mortgage; whether name search matches by prefix or exact name, with first name optional; the largest `ddlShowRec`/`ddlTotalRec` options; the no-records marker text; and whether Essex's Register indexes lis pendens
- [x] 1.4 Confirm Node 24's default trust store connects to all four hosts. If Burlington's chain fails, capture the missing intermediate certificate for its configuration
- [x] 1.5 Write the findings into `design.md` (resolve the Open Questions, and adjust D5 step 3 if there's no cross-reference) before starting group 4

## 2. Database schema

- [x] 2.1 Add `packages/database/src/schema/clerkRecords.ts` with `ClerkDocument`, `ClerkDocumentParty`, `ClerkDocumentLink`, `ListingClerkDocument` and `ListingClerkLookup`, plus their enums and unique indexes and the cascade foreign keys from design D11. Export them from `schema/index.ts`
- [x] 2.2 Run `npm run db:generate`, review the SQL to confirm it only creates objects and changes no existing table, and commit the migration
- [x] 2.3 Apply the migration to the local docker-compose database and check the indexes and FKs with `\d`

## 3. Module skeleton and shared pieces

- [ ] 3.1 Create `backend/src/modules/clerkRecords/` with `scrape/`, `parse/`, `match/`, `ingest/`, `__fixtures__/`, `pipeline.ts`, `handler.ts`, `handler.local.ts` and `index.ts`. Add a `start:clerkRecords` script that runs `handler.local.ts` with `tsx`
- [x] 3.2 Define `scrape/types.ts`: the `ClerkPlatformClient` interface, the search input types, `DocCategory`, and the search result union (documents, `municipality_unresolved`, `blocked`)
- [x] 3.3 Implement `parse/normalizeName.ts` and `splitDefendants`, with tests covering every Party-name normalization scenario plus cases from real listing defendants and plaintiffs in the fixtures
- [x] 3.4 Implement `parse/extractParcel.ts` and block/lot comparison, with tests for every Block/lot extraction scenario. Run it over a prod export of upcoming listings' `parcel`/`description` and record the hit rate per county in the PR
- [x] 3.5 Implement docket-year parsing from `courtCase` (`F-012441-25`, `F00258326`, plus the formats seen in prod), with tests

## 4. PRESS adapter

- [x] 4.1 Write `scrape/platforms/press/counties.ts` with the four counties' configuration: URL, field prefix, max window, `NewSearch` flag, qualifier field, block/lot index start date, municipality alias map built from prod `city` values against the dropdown fixtures, doc-type description map from the dropdown fixtures, and an optional extra CA
- [x] 4.2 Implement `parse/docCategory.ts`: description → `DocCategory` for each county, and category → dropdown option values. Unmapped descriptions become `OTHER`. Add tests against the dropdown fixtures
- [x] 4.3 Implement `parse/platforms/press/parsePressResultGrid.ts`: read the grid, treat `N/A` as null, group rows into documents by instrument number or book/page, detect the no-records marker and fail on unexpected pages, and read the pager. Test it against every result fixture
- [x] 4.4 Implement the `clerkDocumentSchema.ts` zod validation of grouped documents. Reject rows with no instrument or book/page, or an unparseable date. Turn other bad fields into warnings
- [x] 4.5 Implement `scrape/platforms/press/pressClient.ts`: entry-page GET with the cookie jar, hidden-field collection, the tab-specific POST built from the county prefix, paging postbacks up to `MAX_RESULT_PAGES`, the largest rows-per-page option, date-window splitting, and live municipality checking. Unit-test it with the stub axios adapter and the fixtures, asserting the posted form bodies
- [x] 4.6 Add the per-host limiter (concurrency 1, at least 1.5 s apart), the 30 s timeout, one retry on network errors and 5xx, and the stop after 3 consecutive 403/429 responses. Test them with fake timers
- [ ] 4.7 If the spike found a detail view, implement `getDetail` and `parsePressDetail.ts`: consideration, party roles, and cross-references into `ClerkDocumentLink` targets. Test against the detail fixtures
- [x] 4.8 Implement `saveResultPageToS3.ts` (best-effort, a single `PutObject`, the `clerk-records/…` key) and call it before each parse

## 5. Matching

- [x] 5.1 Implement candidate selection: supported counties, due by `nextCheckAt`, sale no more than 90 days past, capped at 40 per county, nearest sale first. Test it against the local DB or a mocked query
- [x] 5.2 Implement the lis pendens match in `match/matchListing.ts`: the search window from the docket year, the acceptance rules, and high/medium confidence. Test every Lis pendens match scenario with fixture-backed client stubs
- [x] 5.3 Implement the parcel sweep: block/lot from the lis pendens or the listing, role assignment, and the block/lot index start date. Test the deed-chain and sheriff's-deed scenarios
- [x] 5.4 Implement the foreclosed-mortgage match: cross-reference, then parcel, then name search, with low-confidence ambiguity. Test each path
- [x] 5.5 Implement the re-check schedule (`nextCheckAt` and the counters for each outcome), with a table-driven test covering design D10

## 6. Ingest

- [x] 6.1 Implement `ingest/syncClerkDocuments.ts`: upsert documents on `(county, instrumentNumber)`, filling nulls without overwriting values with null; insert missing parties and links; resolve `toDocumentId` for links whose target exists
- [x] 6.2 Implement `ingest/syncListingMatches.ts` and `lookupState.ts`, and write each listing's whole result in one transaction. If the write fails, record the `error` outcome in a separate write
- [x] 6.3 Test it: an idempotent second write adds no rows, a sparser row doesn't erase data, a rollback partway through leaves nothing, and deleting a listing cascades. Use the existing DB mocking conventions, plus one test against the local database if the repo has an integration-test pattern

## 7. Pipeline and handler

- [ ] 7.1 Implement `pipeline.ts`: for each county, select candidates and run lookups through the county's limiter until `RUN_DEADLINE_MS`. Isolate per-listing failures, apply the county failure rules, and log the per-county run summary
- [ ] 7.2 Implement `handler.ts`: DB health check, then all PRESS counties under `Promise.allSettled`, throwing if any county failed. Implement `handler.local.ts` with dotenv and an optional county argument
- [ ] 7.3 Export only `handler` from `index.ts`. Confirm `clerkRecords` imports nothing from `modules/sheriffSale`, and that the stage import direction is `scrape`/`parse` → `match` → `ingest`
- [ ] 7.4 Run `npm run start:clerkRecords -- Passaic` against the local DB with a small cap. Check the stored documents and matches for 3 listings by hand against the portal

## 8. Build and infrastructure

- [ ] 8.1 Change the `backend` `bundle` script to build `dist/index.js` and `dist/clerkRecords/index.js`. Check that both export `handler` and that the scraper bundle contains no `clerkRecords` paths
- [ ] 8.2 Add `infra/clerkRecords.tf`: the archive data source for the new bundle, the `new-jersey-clerk-records` function (scraper role, DLQ, 0 retries, same env inputs), its log group with the scraper's retention, the `cron(0 2 * * ? *)` rule, its target and the invoke permission
- [ ] 8.3 Update CI, if the `build` job's artifact upload or the infra job's bundle path needs the new file. Run `tofu plan` and confirm it creates only new resources and leaves the scraper function unchanged

## 9. Verification

- [ ] 9.1 Run `vp test`, `vp lint` and `vp fmt --check` across the workspace
- [ ] 9.2 Run `openspec validate add-clerk-records-press --strict`
- [ ] 9.3 After deploy, invoke `new-jersey-clerk-records` once by hand. Check the per-county summary in its log group, the objects under `clerk-records/` in the bucket, and row counts in the new tables
- [ ] 9.4 After the first week, run a prod query for match coverage per county (listings with a `FORECLOSED_LIS_PENDENS` match ÷ listings looked up) and the confidence split, and record the results on the change
