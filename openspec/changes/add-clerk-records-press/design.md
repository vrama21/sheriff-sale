## Context

The backend has one module, `modules/sheriffSale`. It scrapes civilview's sheriff-sale pages once a day from a single Lambda, normalizes them, and upserts `Listing` and `StatusHistory` rows. Nothing enriches a listing after it's written. `latitude`, `longitude` and `mapsUrl` exist but nothing fills them.

We surveyed the clerk record portals for the 16 counties we list. Four of them run **PRESS**, an ASP.NET WebForms app, at these addresses:

| County                    | Entry point                                                        | Notes                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Essex (Register of Deeds) | `press.essexregister.com/ProdPRESS/Clerk/ClerkHome.aspx?op=basic`  | Block is often `N/A` on notices of settlement                                                                                      |
| Passaic                   | `records.passaiccountynj.org/PRESS/clerk/ClerkHome.aspx?op=basic`  | Older build: `_ctl0:PageContent:` field prefix, needs `hidDiv=NewSearch`                                                           |
| Monmouth ("OPRS")         | `oprs.co.monmouth.nj.us/oprs/clerk/clerkhome.aspx?op=basic`        | 90-day maximum search window; needs the session cookie from a first GET                                                            |
| Burlington                | `press.burlingtoncountynj.gov/Press/clerk/ClerkHome.aspx?op=basic` | Has a `txtQualifierTab4` field; block/lot index starts 3/2012; strict TLS chain (the spike found Node's default store verifies it) |

All four share one form:

- **Tab 1, Name**: last name, first name, doc type, from/to dates.
- **Tab 2, Doc Type**: doc type, municipality, dates.
- **Tab 3, Instrument / Book-Page**.
- **Tab 4, Block/Lot**: municipality, block, lot, (qualifier), dates.

Searching takes a GET of the page for `__VIEWSTATE`, `__EVENTVALIDATION` and the cookie, then a POST of the form with the tab's search button. Results come back in a `dgdDeedMort` grid with one row per direct/indirect party pair. Its columns are Type (a description, not a code), Direct Party, Indirect Party, Instrument #, Recorded, Town Name, Block, Lot, Book and Page. Paging and "View Image" are `__doPostBack` links. We haven't yet looked at whether PRESS has a per-document detail view, or what it shows.

The prod data shapes the matching:

- 1,307 listings are upcoming. 477 of them are in the four PRESS counties.
- Block/lot can be found in only 22% of upcoming Burlington listings and 27% of Essex listings. Burlington's `parcel` column holds disclaimer text, which is a separate bug.
- Every listing has a `defendant`, a `plaintiff` and, in practice, a `courtCase` docket number.

The proposal covers why this is worth doing. The specs `press-scraping`, `clerk-records-matching` and `clerk-records-storage` hold the requirements.

## Goals / Non-Goals

**Goals:**

- For each upcoming listing in a PRESS county, find and store:
  - the foreclosure lis pendens
  - the mortgage it forecloses, and that mortgage's assignments
  - the deed chain for the parcel
  - after the sale, the sheriff's deed
- Record how each match was made and how confident it is, so a wrong match can be explained and filtered out.
- Keep the request volume to each county small, steady and bounded.
- Make the storage and matching platform-neutral, so Hudson (Acclaim), Union (UCPA) and Salem (BrowserView) are adapter-only changes later.

**Non-Goals:**

- Any county that needs a captcha token or a login. We will not try to obtain or fake reCAPTCHA tokens.
- Document images, PDFs and OCR. We store index data and, where PRESS offers it, detail metadata.
- Frontend display. This change only populates the tables.
- Fixing the sheriff-sale scraper's Burlington `parcel` bug. Block/lot extraction tolerates it by rejecting text that isn't a parcel.
- A full title search. We store what the clerk's index exposes for the listing's parties and parcel. That doesn't establish ownership or lien priority.

## Decisions

### D1. One module with platform adapters behind a narrow interface

`modules/clerkRecords/` follows the module layout:

```
scrape/
  platforms/press/      pressClient.ts (session + postbacks), counties.ts (per-county config)
  types.ts              ClerkPlatformClient interface, search inputs, RawResultPage
  saveResultPageToS3.ts
parse/
  platforms/press/      parsePressResultGrid.ts, parsePressDetail.ts (if the spike finds a detail view)
  clerkDocumentSchema.ts  zod: ParsedClerkRow → ClerkDocumentRecord
  docCategory.ts        description → canonical category, per platform
  extractParcel.ts      block/lot from listing text
  normalizeName.ts
ingest/
  syncClerkDocuments.ts, syncListingMatches.ts, lookupState.ts
match/
  matchListing.ts       the chain in D5; calls a ClerkPlatformClient and the parsers
pipeline.ts, handler.ts, handler.local.ts, index.ts, __fixtures__/
```

`match/` is a fourth stage folder because the chain alternates between fetching and parsing, and the result of one search decides the next search. It sits after `parse/` and before `ingest/` in the import order. It returns plain records, and `pipeline.ts` hands them to `ingest/`.

`ClerkPlatformClient` exposes:

- `searchByName({ name, docCategories, from, to })`
- `searchByParcel({ municipality, block, lot, qualifier?, docCategories?, from?, to? })`
- `searchByInstrument(instrumentNumber)`
- `getDetail?(row)`, which is optional

Each search returns parsed rows, already grouped into documents. PRESS's quirks stay inside the PRESS client: field prefixes, the `NewSearch` flag, the qualifier field and date windows.

_Alternative considered:_ one module per platform, each with its own tables. We rejected it because matching and storage are the bulk of the logic and are identical across platforms.

### D2. Identify documents by county and instrument number

Every PRESS row has the county's instrument number, which is unique within that county. BrowserView's `file_num` and Acclaim's `InstrumentNumber` are the same identifier, so a later adapter writing the same document lands on the same row. Older records indexed only by book and page get a synthetic key, `BK:<book>/<page>`. PRESS exposes no internal document ID in the grid, so there's no better key.

### D3. Map doc types to canonical categories, and keep the raw description

PRESS shows descriptions like `LIS PENDENS FORECLOSURE`, which vary by county. A per-platform, per-county map turns them into an enum:

- `DEED`, `SHERIFF_DEED`
- `MORTGAGE`, `MORTGAGE_ASSIGNMENT`, `MORTGAGE_DISCHARGE`, `MORTGAGE_MODIFICATION`
- `LIS_PENDENS`, `LIS_PENDENS_DISCHARGE`
- `FINAL_JUDGMENT`, `NOTICE_OF_SETTLEMENT`, `TAX_SALE_CERTIFICATE`, `LIEN`
- `OTHER`

The raw description is always stored. An unmapped description becomes `OTHER` and is counted in the run summary, so gaps in the map show up in logs. The same map runs the other way: to pick a doc type in PRESS's dropdown, the client chooses the county's option values for a category.

### D4. Group rows into documents before validating

Each document comes back as several grid rows, one per direct/indirect party pair, sometimes on different pages. The parser groups rows by instrument number. It unions the direct and indirect party sets and takes town, block, lot, book and page from the first row that has them. The zod schema validates the grouped document. A missing instrument number and book/page, or an unparseable recorded date, rejects the row and logs it. Other bad fields become warnings, matching `listing-validation`.

### D5. Matching starts from the lis pendens

_Revised after the spike (see "Spike findings" below). The changes from the first draft: the name search runs once, across all doc types and with no dates, and is filtered locally; the docket-year window is a filter on recorded dates, not a search range; the cross-reference path doesn't exist on PRESS; Passaic has no block/lot index, so it gets no parcel sweep._

For each candidate listing:

1. **Lis pendens by party.** Run one name search for the primary defendant across all doc types, with no dates (D6 gives the search term). PRESS's doc-type dropdown takes a single value, and Essex files foreclosures under four lis pendens types, so one all-types search costs fewer requests than one per type. It also returns the defendant's mortgages, assignments and deeds, which steps 2 and 3 reuse.
   - Keep the `LIS_PENDENS` documents recorded inside the docket-year window. The window comes from the docket year in `courtCase` (`F-012441-25`, `F00258326`, Passaic's `F 012110 25 CTL#163224`) and runs from 1 January of that year to the sale date. If there's no docket, it's the sale date minus 3 years.
   - A candidate is accepted when:
     - one of its direct parties matches one of the listing's defendants, **and**
     - its indirect parties match the plaintiff, **or** its town and block/lot agree with the listing's.
   - Confidence:
     - **high**: the defendant, the plaintiff and the town all agree.
     - **medium**: the defendant matches, but only one of the other two agrees. This covers a plaintiff substituted after an assignment. The spike's Monmouth case is one: the lis pendens names GUARANTEED RATE INC, and the listing names the later assignee, Lakeview.
     - Anything weaker isn't stored.
2. **Parcel sweep.** This step is skipped for counties whose index has no block/lot (Passaic). Block/lot comes from, in order:
   - the matched lis pendens row (Monmouth and Burlington fill it; Essex and Passaic show `N/A`)
   - a deed in the name-search results whose grantee is a defendant (Essex fills block/lot on deeds)
   - the listing text (D7)

   Run one Block/Lot search with no dates and no doc type, and filter locally. Documents whose parties overlap the listing's defendants are matched `parcel`/high. The rest of the parcel's documents are matched `parcel`/medium. If block/lot came only from the listing text and none of the parcel's documents has a defendant as a party, the sweep is discarded as a likely wrong parcel. Burlington's metes-and-bounds descriptions mention neighbouring lots, which is how this happens. Burlington's parcel index starts in 3/2012, and Essex's block/lot index in practice holds only deeds, so documents missing there come only from steps 1 and 3.

3. **Foreclosed mortgage.** The spike found no cross-reference in PRESS: Passaic's detail view repeats the grid row, and the others' "View" opens the document image. So the `cross_reference` path isn't implemented for PRESS. `getDetail` stays an optional interface method for later platforms. Pick the method in this order:
   - the latest mortgage from step 2 recorded before the lis pendens whose mortgagor matches a defendant (`parcel`/high)
   - otherwise, the mortgages in step 1's name-search results that were recorded before the lis pendens and whose mortgagor matches a defendant. No extra request is needed. Pick by mortgagee similarity to a foreclosing party (`mortgage_party`/medium). The foreclosing parties are the plaintiff, the lis pendens plaintiff, and the assignor of any assignment, in the parcel's or the name search's results, whose assignee is already a foreclosing party. So a mortgage to GMAC that GMAC assigned to the plaintiff is plausible. If more than one candidate is still plausible, store each at **low** confidence.

   Assignments in the name-search results that a defendant is a party to, recorded after the chosen mortgage, are matched `MORTGAGE_ASSIGNMENT` by `mortgage_party`/medium.

4. **After the sale.** Once the sale date has passed, steps 1 and 2 run again on each re-check, so a `SHERIFF_DEED` on the parcel shows up when it's recorded. Passaic has no parcel sweep, so its sheriff's deeds aren't matched in this change. Its post-sale checks follow the D10 schedule and stop at sale + 90 days.

Each match gets a role:

- `FORECLOSED_LIS_PENDENS`, `FORECLOSED_MORTGAGE`, `MORTGAGE_ASSIGNMENT`
- `PRIOR_DEED`, `SHERIFF_DEED`
- `RELATED`, for anything else on the parcel

_Alternative considered:_ parcel-first matching. It would fail for most Essex and Burlington listings because their block/lot is missing, and it wouldn't tell the foreclosed mortgage apart from other loans on the parcel.

### D6. Party-name normalization is shared by matching and storage

`normalizeName`:

- uppercases
- strips punctuation
- collapses whitespace
- removes entity suffixes: LLC, L.L.C., INC, CORP, CO, NA, N.A., FSB
- removes role phrases: `AS TRUSTEE FOR …`, `ET AL`, `ET UX`, `H/W`, `HIS WIFE`, `AKA …`, `INDIVIDUALLY`, `MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC AS NOMINEE FOR` → the nominee

Two names match when their token sets agree. The order of tokens doesn't matter, because listings say "John Smith" and the clerk says "SMITH JOHN". For entity names, the overlap must clear a threshold, tuned against fixtures and starting at 0.8 Jaccard.

The listing's `defendant` string splits on `;`, `AND` and `, ` into a defendant list. Splitting on `, ` happens only after role phrases are removed, so "SMITH, JOHN" stays one name.

The search term sent to PRESS is the first person defendant's surname in the last-name field and their first given name in the first-name field. For an entity, it's the full normalized name in the last-name field. The spike showed the first name is optional and matched as a prefix (`ANDREW` found `HAMILTON ANDREW L`, and `NICHOLAS` found `HUBBARD NICHOLAS JR`), and it cuts a common surname's results from hundreds of rows to one page. Matching then filters the results. The normalized name is stored on each party row, so later adapters and queries compare names the same way.

### D7. Block/lot extraction rejects text that isn't a parcel

`extractParcel(parcel, description)` tries an ordered set of patterns:

- `TAX LOT x BLOCK y`
- `LOT x IN BLOCK y`
- `Lot and Block: Lot x, Block y`
- `BLOCK y LOT x`
- `Blk`/`Lt` abbreviations

It also handles additional lots ("ADDITIONAL LOTS 12, 18-B") and condo qualifiers (`C0201`). It returns `{ block, lot, extraLots, qualifier }` or null. Text that matches none of the patterns, like Burlington's disclaimer, returns null. To compare values, it strips leading zeros from the integer parts and keeps decimal blocks such as `20.13` as they are.

### D8. Municipality names come from a per-county alias map checked against the live dropdown

Listing `city` values ("Margate City", "South Orange") and PRESS dropdown labels ("SOUTH ORANGE VILLAGE") differ. `counties.ts` holds a per-county alias map. At run start the client reads the dropdown options from the landing page and checks every alias target against them. If one is missing, it logs a warning and skips parcel search for that town. Name search still runs.

A listing city resolves to an ordered list of candidate labels:

1. the alias map's entry
2. a label that equals the city once suffixes such as `TWP`, `TOWNSHIP`, `BORO`, `BOROUGH`, `CITY` and `VILLAGE` are dropped from both
3. the longest label the city text ends with, which rescues values like `55 Tulip Lane Red Bank`

Parcel search uses the first candidate that is live in the dropdown. Town agreement in D5 accepts any candidate. Monmouth's dropdown lists postal names (`LEONARDO`, `BELFORD`) alongside municipalities. Its documents carry the municipality (`MIDDLETOWN`), so section names alias to the municipality first.

### D9. Request politeness and the per-run budget

- Each county host gets its own limiter with concurrency 1 and at least 1.5 s between requests.
- Requests time out after 30 s and are retried once after 5 s on network errors or 5xx responses. A 4xx is not retried.
- Requests carry a normal browser User-Agent.
- Paging asks for the largest rows-per-page option and stops after `MAX_RESULT_PAGES` (5). If the stop truncates results, that's logged with the search key.
- Each run looks up at most `MAX_LISTINGS_PER_COUNTY_PER_RUN` (40) listings per county, nearest sale date first.

Only Passaic's results page carries the search form, so every search starts with a GET of the entry page: a search is a GET plus a POST, plus one POST per extra page. A lookup is one name search and, where the county indexes block/lot, one parcel sweep. At about 4 to 8 requests per listing, that's at most about 320 requests per county per run, roughly 8 minutes with the delay. The four counties run in parallel on separate hosts, which fits the 900 s Lambda timeout. A listing whose lookup hasn't finished by `RUN_DEADLINE_MS` (780 s) is left for the next run without being marked failed.

### D10. Re-check schedule (per-listing lookup state)

`ListingClerkLookup` stores `nextCheckAt`, and the run selects candidates where `nextCheckAt <= now`. A listing with no row is due immediately.

| Outcome                               | Next check                                                               |
| ------------------------------------- | ------------------------------------------------------------------------ |
| Lis pendens matched, sale upcoming    | in 14 days, and no later than the sale date                              |
| No lis pendens found                  | in 7 days. After 6 consecutive misses, every 30 days until the sale date |
| Sale date passed, no sheriff deed yet | sale + 30 days, + 60 days, + 90 days, then stop                          |
| Sheriff deed matched                  | stop                                                                     |
| County unsupported                    | never                                                                    |
| Error                                 | in 1 day. After 5 consecutive errors, back off to 7 days                 |

### D11. Storage tables

All tables are new and live in `packages/database/src/schema/clerkRecords.ts`:

- **`ClerkDocument`**:
  - `id` uuid, `county`, `instrumentNumber` (unique with `county`), `platform`
  - `docCategory`, `docTypeRaw`, `recordedDate`
  - `bookType`, `book`, `page`
  - `municipality`, `block`, `lot`, `qualifier`
  - `consideration` numeric(14,2) null, `detail` jsonb null
  - `firstSeenAt`, `lastSeenAt`, timestamps
- **`ClerkDocumentParty`**: `id`, `documentId`, `side` (`direct` | `indirect`), `name`, `normalizedName`. Unique `(documentId, side, name)`.
- **`ClerkDocumentLink`**: `id`, `fromDocumentId`, `toInstrumentNumber` null, `toBook` null, `toPage` null, `toDocumentId` null (filled once the target is stored). Unique `(fromDocumentId, toInstrumentNumber, toBook, toPage)`.
- **`ListingClerkDocument`**: `listingId`, `documentId`, `role`, `matchedBy` (`lis_pendens_party` | `parcel` | `cross_reference` | `mortgage_party`), `confidence` (`high` | `medium` | `low`), `firstMatchedAt`, `lastConfirmedAt`. Unique `(listingId, documentId)`.
- **`ListingClerkLookup`**: `listingId` PK, `platform`, `lastCheckedAt`, `nextCheckAt`, `lastOutcome`, `consecutiveMisses`, `consecutiveErrors`, `lastError`.

Write rules:

- **Documents** upsert on `(county, instrumentNumber)`. An upsert updates `lastSeenAt`, fills null columns and never replaces a non-null value with null. Recorded documents don't change, so this is insert-mostly.
- **Parties and links** insert with `ON CONFLICT DO NOTHING`.
- **Matches** upsert to refresh `lastConfirmedAt`, `role`, `matchedBy` and `confidence` from the latest run. They're never deleted automatically. A document missing from one day's results is not evidence against the match.
- **Lookup state** is written at the end of each listing's lookup.

Each listing's documents, matches and lookup state are written in one transaction.

Foreign keys: party and link rows reference `ClerkDocument` with cascade delete, and the matches table references `Listing` and `ClerkDocument` with cascade delete. The existing tables have no FK constraints (`StatusHistory`), but these tables are new and the integrity costs nothing. The duplicate-repair migrations delete `Listing` rows, and cascading keeps matches from being orphaned.

### D12. Deploy as a separate Lambda that shares the role, bucket and DLQ

- The `bundle` script runs esbuild twice:
  - `src/modules/sheriffSale/handler.ts` → `dist/index.js`, unchanged
  - `src/modules/clerkRecords/handler.ts` → `dist/clerkRecords/index.js`
- `infra/clerkRecords.tf` adds:
  - the `new-jersey-clerk-records` function: nodejs24.x, 512 MB, 900 s, environment `DATABASE_URL` only (matching the scraper since `harden-ci-env-and-ops` removed `ENV`)
  - its own log group
  - an EventBridge rule at `cron(0 2 * * ? *)`, two hours after the sheriff-sale scraper, so that day's new listings exist
- It reuses `new-jersey-sheriff-sale-scraper-role` and its DLQ. Raw pages go to `nj-sheriff-sale` under the `clerk-records/` prefix, which the existing `nj-sheriff-sale/*` policy already allows.
- The handler runs a DB health check, then the four counties under `Promise.allSettled`. It throws if any county fails as a whole, the same as the scraper.

_Alternative considered:_ running clerk lookups at the end of the existing handler. We rejected it because both jobs would share one 900 s budget and fail together, and a clerk portal outage would mark the sheriff-sale run failed.

### D13. Archive raw result pages on a best-effort basis

Every search result page is saved with the existing `saveS3` helper before it's parsed, at `clerk-records/<county-slug>/<YYYY-MM-DD>/<listingId>-<step>-<n>.html`. As in `scraper-pipeline`, an archive failure is logged and doesn't stop parsing. The archive gives us fixtures for parser fixes and a way to re-parse later. Replay tooling isn't part of this change.

## Risks / Trade-offs

- **[PRESS markup changes, or a county moves to another vendor]** → Parsers fail loudly. If a county's result page has no grid and no "no records" marker, the run counts it as a parse failure for that county, not an empty result. Fixtures come from real archived pages.
- **[Wrong matches on common names]** → Every match needs the defendant plus a second signal. Confidence and `matchedBy` are stored, and only `high` and `medium` are created, except the documented low-confidence mortgage candidates. Consumers can filter on confidence.
- **[Plaintiff substitution after an assignment]** → The plaintiff on the listing may not match the lis pendens. Town plus block/lot still allows a `medium` match, and the parcel's assignments in step 2 can confirm the chain.
- **[Monmouth's 90-day window multiplies requests]** → Docket-year windows keep most lookups to 5 or 6 slices. The per-run cap and per-host delay bound the total.
- **[Burlington's parcel index starts 3/2012]** → Older deeds and mortgages there come only from name search. That's documented in the per-county config, and a parcel sweep result there isn't treated as complete.
- **[Daniel's Law redactions]** → Covered persons' names may be redacted in the index, and matching by party will then miss. The lookup records `no_lis_pendens` and keeps re-checking on the schedule. Nothing works around redactions.
- **[A portal throttles or blocks us]** → Low concurrency, delays and the per-run cap keep volume small. Repeated 403/429 responses mark the county failed for the run and stop its remaining lookups, rather than retrying harder.
- **[Burlington's strict TLS chain]** → Node's bundled CA store needs checking against it in the spike. If it fails, add the missing intermediate to the client's agent for that host only, never by turning off verification. The spike found the default store verifies it, so no intermediate is configured.

## Migration Plan

1. Archive `isolate-sheriff-sale-module`, so the modified infra specs apply on top of its paths.
2. Merge the schema and the generated migration. CI runs `db:migrate` before deploying. All tables are new, so the migration is expand-only.
3. Merge the module and infra. CI applies the new Lambda and schedule. The first runs work through the backlog, 40 listings per county per run, nearest sale first, so all of PRESS's 477 upcoming listings are covered in about 3 days.
4. Watch the run summary logs (matched / no lis pendens / errors / unmapped doc types per county) for the first week. Adjust the name threshold and alias maps with fixture-backed tests.

**Rollback:** disable the EventBridge rule, or remove the infra resources. The tables are additive and nothing else reads them yet, so they can stay or be dropped in a later migration.

## Spike findings (task 1)

The spike ran on 2026-10-18 with a throwaway script: one session at a time, at least 2 s between requests, Node 24's default trust store. Its pages are the fixtures under `modules/clerkRecords/__fixtures__/press/<county>/`. Each county took 11 to 17 requests, more than planned, because fixing the script's own bugs (it posted from the wrong page and missed image buttons) needed fresh entry GETs. No county throttled, blocked or challenged a request, and none of the pages has a captcha.

Test listings: Passaic `F 012110 25` (Cabigao, Clifton), Essex `F00863924` (Hamilton, Livingston), Monmouth `F00463123` (Hubbard, Leonardo/Middletown), Burlington `F-007795-24` (Lundy, Hainesport). The lis pendens was found for all four.

**Open questions, resolved:**

- **The PRESS detail view.** Each row has a "View" control: a submit button in Passaic, an image input elsewhere. It posts back and redirects to `ShowDetails.aspx`.
  - Passaic shows "Instrument Details": type, instrument number, date, book/page, all mortgagors and mortgagees separated by `;`, block/lot and township. That is no more than the grid. There's no consideration and no cross-reference.
  - Essex, Monmouth and Burlington show an image-viewer frame (`ShowDetails.htm`) for the document image, which is out of scope.
  - So D5 step 3 has no `cross_reference` path, task 4.7 is skipped, and `consideration` stays null for PRESS.
- **Party orientation.** The same in all four counties: the grid's first party column is the grantor, mortgagor or defendant, and the second is the grantee, mortgagee or plaintiff. On a lis pendens the defendants are direct and the plaintiff is indirect. On a mortgage the mortgagor is direct. On a deed into the defendant, the defendant is indirect. On an assignment, the assignor (and often the mortgagor) is direct and the assignee is indirect. The header text changes with the doc type (`Direct Party`, `Mortgagor`, `Grantor`), so the parser reads columns by position. Burlington has an extra `Qualifier` column, and Monmouth and Burlington an extra `Action` column, so the column map comes from the header row.
- **Name search.** The first name is optional and matched as a prefix. The last name is a required field. The grid shows every party pair of each matching document, including co-parties who didn't match the search. Whether the last name is also a prefix match wasn't tested.
- **Rows per page.** `ddlShowRec` goes up to 100 in all four. `ddlTotalRec` goes up to 750 in Essex and Passaic and 2000 in Monmouth and Burlington. The pager is a row of `__doPostBack` page-number links at the top of `dgdDeedMort`. No total row count is shown, so truncation means the pager lists more than `MAX_RESULT_PAGES` pages.
- **Essex lis pendens.** Essex's Register indexes them in the same PRESS instance, under four types. The test case was `LIS PENDENS FORECLOSURE AND RECOVERY`, not `LIS PENDENS FORECLOSURE`, which is why matching searches all types (D5).

**Other findings:**

- **The date window limits all four counties.** Essex and Monmouth state "Maximum Date Range between From and To dates is 90 days", and Passaic answers a longer range with `Date Range should not be more than '90' days.` (fixture `passaic/date-range-error.html`). Burlington runs the same release. The dates are optional everywhere, so matching sends none. The client still splits a requested range into 90-day windows, and all four counties are configured with 90 days. That contradicts the press-scraping scenario "County without a limit" (Essex). That scenario is exercised with a synthetic config instead.
- **No-records marker.** All four show `No results found` in `lblMessage`. Any other message there, such as Passaic's date-range error, is a parse error.
- **Block/lot coverage.**
  - Passaic shows `N/A` for block on every document, deeds and mortgages included. A block/lot search for a known parcel returned nothing (`passaic/parcel-no-results.html`). So Passaic has no parcel sweep.
  - Essex fills block/lot on deeds only, so its parcel sweep returns the deed chain.
  - Monmouth fills it on lis pendens, mortgages, deeds and most assignments.
  - Burlington fills it from 3/2012, with one row per lot for multi-lot documents (`47.02/11` and `47.02/11.01`).
- **Result order differs by county.** Passaic and Monmouth list oldest first, and Burlington newest first. Essex groups rows by type. Truncation can therefore drop either end, so it's logged.
- **Document keys.**
  - Instrument numbers are 10 digits in Passaic and Monmouth, 7 in Burlington, and both 7 and 10 in Essex. Every document seen had one.
  - Books carry a type prefix (`M3873`, `D988`, `AS92`, `DM186` in Passaic; `OR-9597`, `MB-4786` in Monmouth and Burlington; plain `12000` in Essex). The parser splits the prefix into `bookType`.
- **The doc type in the grid is the dropdown label.** Labels include Monmouth's `DEEDS From 10/01/1996 to Present`, `MORTGAGES from 01/01/1976 to 12/31/1996` and `FORECLOSURE LISPENDENS`, so the description map is built from the dropdown fixtures.
- **Sessions.** Every host sets `ASP.NET_SessionId` on the entry GET. Monmouth marks it `secure`. Only Passaic's results page carries the search form (D9).
- **TLS.** Node 24.22's default trust store verifies all four hosts, Burlington included. No extra CA is configured. The `extraCa` option stays in the county config, unused.
- **Clerk spelling varies.** Monmouth indexes one party as both `HUBBARD NICHOLAS SR` and `HUBBARD NICOLAS SR`. Token-set equality misses such typos, but another defendant's row usually carries the match.
