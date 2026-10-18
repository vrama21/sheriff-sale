## Why

A sheriff-sale listing shows the foreclosure notice, but not the documents behind it: the mortgage being foreclosed (amount, lender, date), who the loan was assigned to, the last deed into the owner, and the sheriff's deed that records the sale's outcome. All of these are public records at the county clerk, and several NJ clerk portals serve them over plain HTTP with no login or bot protection.

A survey of the portals for every county we list found 7 reachable over plain HTTP. Four of them (Essex, Passaic, Monmouth and Burlington) run the same ASP.NET WebForms product, "PRESS". Those four hold 477 of the 1,307 upcoming listings in prod (36%), so one adapter covers more than a third of what users see. The other reachable counties (Hudson on Acclaim, Union on a homegrown site, Salem on an older BrowserView) and Gloucester (not yet tested) come in later changes on the storage and matching built here. Seven counties are out of reach: Atlantic, Bergen, Middlesex, Camden, Cape May, Ocean and Morris enforce reCAPTCHA v3 on the server, which this project will not try to defeat. Cumberland requires an account, and Hunterdon has no online search.

Block/lot can't be the primary way to match. Only 22% of upcoming Burlington listings and 27% of Essex listings carry a block number anywhere, and Burlington's `parcel` column holds disclaimer text. Every listing does carry a defendant, a plaintiff and a docket number, and the clerk records the foreclosure lis pendens under the same defendant and plaintiff. So matching starts from the lis pendens and works outward from it.

## What Changes

- Add a `clerkRecords` backend module (`backend/src/modules/clerkRecords/`) with the standard `scrape/`, `parse/` and `ingest/` stages, a `pipeline.ts`, and its own Lambda entry point.
- Add a **PRESS platform adapter** with per-county configuration for Essex (Register of Deeds), Passaic, Monmouth and Burlington. It handles the WebForms session (cookie and hidden fields), searches by name, block/lot and instrument, reads the result grid and its paging, and respects per-county limits such as Monmouth's 90-day date window. Requests are polite: low concurrency per host, a delay between requests, and only the lookups a listing needs. Raw result pages are archived to S3 on a best-effort basis.
- Add **listing-to-document matching**:
  - Pick the candidate listings: upcoming listings in supported counties, plus recently sold ones so their sheriff's deed is caught.
  - Normalize party names.
  - Find the foreclosure lis pendens by defendant name, and confirm it by plaintiff (plus town, and block/lot when known).
  - From the lis pendens, find the foreclosed mortgage and its assignments, and the deed chain by block/lot.
  - Record how each document was matched and with what confidence.
  - Re-check each listing on a schedule instead of every day.
- Add **block/lot extraction** from a listing's `parcel` and `description` text, used to corroborate matches and to search for deeds.
- Add database tables for recorded documents, their parties, their links to other documents, the listing-to-document matches, and per-listing lookup state. Generate the Drizzle migration.
- Deploy the module as a second Lambda, `new-jersey-clerk-records`, on its own daily schedule after the sheriff-sale scraper. It reuses the existing archive bucket, role and dead-letter queue. The backend build produces a second bundle.
- Start with a spike that inspects PRESS's document detail view. It decides whether the lis-pendens-to-mortgage step can follow a recorded cross-reference or has to fall back to a party search.

**Out of scope:** the other platforms (Acclaim, UCPA, BrowserView, Avenu i2), any captcha-protected or login-only county, document images and PDFs, showing clerk records in the frontend, and fixing how the sheriff-sale scraper fills Burlington's `parcel` column (tracked separately).

## Capabilities

### New Capabilities

- `clerk-records-storage`: Tables and write rules for recorded documents, their parties and cross-references, listing-to-document matches, and per-listing lookup state. Covers document identity per county and idempotent, insert-mostly writes.
- `press-scraping`: Fetching from PRESS clerk portals: per-county configuration, the WebForms session and postbacks, the search modes, result-grid parsing and paging, date-window limits, request politeness, failure handling and the raw-page archive.
- `clerk-records-matching`: Choosing which listings to look up and when to re-check them; extracting block/lot from listing text; normalizing party names; the lis-pendens-first matching chain and its confidence rules; and per-listing failure isolation within a run.

### Modified Capabilities

- `infra-delivery`: "Lambda bundle build" also bundles `src/modules/clerkRecords/handler.ts` into a second file.
- `scraper-infrastructure`: adds the `new-jersey-clerk-records` Lambda function and its daily schedule and log group. It shares the existing role, archive bucket and dead-letter queue.

## Impact

- **Code:** new `backend/src/modules/clerkRecords/`. `shared/` may gain a name normalizer if it turns out to be useful beyond this module. The `bundle` script in `backend/package.json` changes.
- **Database:** five new tables in `packages/database/src/schema/` with a generated migration (expand-only). `Listing` doesn't change.
- **Infra:** a new Lambda, EventBridge rule and log group in `infra/`. The existing scraper resources don't change.
- **External systems:** a few dozen requests per day to four county clerk portals. Their markup can change without notice, so the parsers rely on fixtures and log loudly when they fail.
- **Dependencies:** no new runtime packages expected. It uses the existing axios, node-html-parser, zod and luxon.
- **Ordering:** this change builds on the module layout from `isolate-sheriff-sale-module`, and that change should be archived first so the modified specs here apply on top of its paths.
