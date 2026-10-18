## Context

The backend has one module, `modules/sheriffSale`. It scrapes civilview's sheriff-sale pages once a day from a single Lambda, normalizes them, and upserts `Listing` and `StatusHistory` rows. Nothing enriches a listing after it's written. `latitude`, `longitude` and `mapsUrl` exist but nothing fills them.

We surveyed the clerk record portals for the 16 counties we list. Four of them run **PRESS**, an ASP.NET WebForms app, at these addresses:

| County | Entry point | Notes |
|---|---|---|
| Essex (Register of Deeds) | `press.essexregister.com/ProdPRESS/Clerk/ClerkHome.aspx?op=basic` | Block is often `N/A` on notices of settlement |
| Passaic | `records.passaiccountynj.org/PRESS/clerk/ClerkHome.aspx?op=basic` | Older build: `_ctl0:PageContent:` field prefix, needs `hidDiv=NewSearch` |
| Monmouth ("OPRS") | `oprs.co.monmouth.nj.us/oprs/clerk/clerkhome.aspx?op=basic` | 90-day maximum search window; needs the session cookie from a first GET |
| Burlington | `press.burlingtoncountynj.gov/Press/clerk/ClerkHome.aspx?op=basic` | Has a `txtQualifierTab4` field; block/lot index starts 3/2012; strict TLS chain |

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

*Alternative considered:* one module per platform, each with its own tables. We rejected it because matching and storage are the bulk of the logic and are identical across platforms.

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

For each candidate listing:

1. **Lis pendens by party.** Name-search the primary defendant for `LIS_PENDENS`.
   - The date window comes from the docket year in `courtCase`. `F-012441-25` and `F00258326` both encode the year in their last two digits. The window runs from 1 January of that year to the sale date. If there's no docket, it's the sale date minus 3 years. The PRESS client splits the window into 90-day slices where the county requires it (Monmouth).
   - A candidate is accepted when:
     - one of its direct parties matches one of the listing's defendants, **and**
     - its indirect parties match the plaintiff, **or** its town and block/lot agree with the listing's.
   - Confidence:
     - **high**: the defendant, the plaintiff and the town all agree.
     - **medium**: the defendant matches, but only one of the other two agrees. This covers a plaintiff substituted after an assignment.
     - Anything weaker isn't stored.
2. **Parcel sweep.** Take block/lot from the matched lis pendens row, which PRESS usually fills, or else from the listing (D7). Run one Block/Lot search with no date limit and doc categories {DEED, SHERIFF_DEED, MORTGAGE*, LIS_PENDENS*, FINAL_JUDGMENT}. Documents whose parties overlap the listing's defendants are matched `parcel`/high. The rest of the parcel's documents are matched `parcel`/medium. Burlington's parcel index starts in 3/2012, so earlier documents there come only from step 3.
3. **Foreclosed mortgage.** Pick the method in this order:
   - If the spike finds that PRESS detail exposes a cross-reference from the lis pendens to the mortgage, follow it with an instrument or book/page search (`cross_reference`/high).
   - Otherwise, use the latest mortgage from step 2 recorded before the lis pendens whose mortgagor matches a defendant.
   - Otherwise, name-search the defendant for `MORTGAGE` before the lis pendens date. Use mortgagee similarity to the plaintiff, or to an assignee in the parcel's assignments, to pick one (`mortgage_party`). If more than one candidate is still plausible, store each at **low** confidence.
4. **After the sale.** Once the sale date has passed, step 2 runs again on each re-check, so a `SHERIFF_DEED` shows up when it's recorded.

Each match gets a role:

- `FORECLOSED_LIS_PENDENS`, `FORECLOSED_MORTGAGE`, `MORTGAGE_ASSIGNMENT`
- `PRIOR_DEED`, `SHERIFF_DEED`
- `RELATED`, for anything else on the parcel

*Alternative considered:* parcel-first matching. It would fail for most Essex and Burlington listings because their block/lot is missing, and it wouldn't tell the foreclosed mortgage apart from other loans on the parcel.

### D6. Party-name normalization is shared by matching and storage

`normalizeName`:

- uppercases
- strips punctuation
- collapses whitespace
- removes entity suffixes: LLC, L.L.C., INC, CORP, CO, NA, N.A., FSB
- removes role phrases: `AS TRUSTEE FOR …`, `ET AL`, `ET UX`, `H/W`, `HIS WIFE`, `AKA …`, `INDIVIDUALLY`, `MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC AS NOMINEE FOR` → the nominee

Two names match when their token sets agree. The order of tokens doesn't matter, because listings say "John Smith" and the clerk says "SMITH JOHN". For entity names, the overlap must clear a threshold, tuned against fixtures and starting at 0.8 Jaccard.

The listing's `defendant` string splits on `;`, ` AND ` and `, ` into a defendant list. Splitting on `, ` happens only after role phrases are removed, so "SMITH, JOHN" stays one name.

The search term sent to PRESS is the surname of the first person defendant, or the full name of the first entity defendant. Matching then filters the results. The normalized name is stored on each party row, so later adapters and queries compare names the same way.

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

### D9. Request politeness and the per-run budget

- Each county host gets its own limiter with concurrency 1 and at least 1.5 s between requests.
- Requests time out after 30 s and are retried once after 5 s on network errors or 5xx responses. A 4xx is not retried.
- Requests carry a normal browser User-Agent.
- Paging asks for the largest rows-per-page option and stops after `MAX_RESULT_PAGES` (5). If the stop truncates results, that's logged with the search key.
- Each run looks up at most `MAX_LISTINGS_PER_COUNTY_PER_RUN` (40) listings per county, nearest sale date first.

At about 4 to 8 requests per listing, that's at most about 320 requests per county per run, roughly 8 minutes with the delay. The four counties run in parallel on separate hosts, which fits the 900 s Lambda timeout. A listing whose lookup hasn't finished by `RUN_DEADLINE_MS` (780 s) is left for the next run without being marked failed.

### D10. Re-check schedule (per-listing lookup state)

`ListingClerkLookup` stores `nextCheckAt`, and the run selects candidates where `nextCheckAt <= now`. A listing with no row is due immediately.

| Outcome | Next check |
|---|---|
| Lis pendens matched, sale upcoming | in 14 days, and no later than the sale date |
| No lis pendens found | in 7 days. After 6 consecutive misses, every 30 days until the sale date |
| Sale date passed, no sheriff deed yet | sale + 30 days, + 60 days, + 90 days, then stop |
| Sheriff deed matched | stop |
| County unsupported | never |
| Error | in 1 day. After 5 consecutive errors, back off to 7 days |

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

*Alternative considered:* running clerk lookups at the end of the existing handler. We rejected it because both jobs would share one 900 s budget and fail together, and a clerk portal outage would mark the sheriff-sale run failed.

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
- **[Burlington's strict TLS chain]** → Node's bundled CA store needs checking against it in the spike. If it fails, add the missing intermediate to the client's agent for that host only, never by turning off verification.

## Migration Plan

1. Archive `isolate-sheriff-sale-module`, so the modified infra specs apply on top of its paths.
2. Merge the schema and the generated migration. CI runs `db:migrate` before deploying. All tables are new, so the migration is expand-only.
3. Merge the module and infra. CI applies the new Lambda and schedule. The first runs work through the backlog, 40 listings per county per run, nearest sale first, so all of PRESS's 477 upcoming listings are covered in about 3 days.
4. Watch the run summary logs (matched / no lis pendens / errors / unmapped doc types per county) for the first week. Adjust the name threshold and alias maps with fixture-backed tests.

**Rollback:** disable the EventBridge rule, or remove the infra resources. The tables are additive and nothing else reads them yet, so they can stay or be dropped in a later migration.

## Open Questions

- **The PRESS detail view** (spike, task 1). Does a "View Image" or row postback show a detail panel with parties' roles, consideration, and cross-references (the "links" BrowserView exposes)? The answer decides whether step 3 of D5 can use `cross_reference` or falls back to party search.
- **The orientation of direct and indirect parties for each doc type, per county.** For example, is the defendant always the direct party on a lis pendens? To confirm from fixtures in the spike.
- **Does PRESS name search match on a prefix or the exact name, and does it treat the first name as optional?** This affects how we build the search term for entities.
- **The largest `ddlShowRec`/`ddlTotalRec` option per county**, which affects how many pages a search needs.
- **Whether Essex's Register of Deeds indexes lis pendens in the same PRESS instance or in a separate court index.** If it doesn't, Essex matching starts from the parcel and the Essex coverage numbers drop.
