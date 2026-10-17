## Why

Even with `fix-scraper-db-pipeline` in place, no listing can reach the database, because the scraper no longer matches salesweb.civilview.com. Checked against the live site on 2026-10-17:

- **The details page layout changed.** Property fields are now `<div class="sale-detail-item">` label/value pairs, and the status history is the page's only `<table>`. `parseListingDetails` reads `tables[0]`, which is now the status table, and `parseStatusHistory` reads `tables[1]`, which doesn't exist. Every listing throws.
- **Sessions are scoped to one county.** A details request without an `ASP.NET_SessionId` gets a 302 to `/`. A session can open details only for the county it last searched, and each search switches it. `NewJerseySheriffSaleHttpClient` is a process-wide singleton that keeps the first session cookie it sees and sends it for all 14 counties running at once, so at most one county gets real detail pages. Axios follows the 302 to the home page (200, no tables), and the parsers throw on it.
- **Passaic's county ID is wrong.** `NJSheriffSaleCountyIdMap` gives Passaic `'19'`, which is Gloucester's ID. The site uses `17`. It has been this way since the backend was added in 2023, so Passaic has never been scraped, and Gloucester is scraped twice under two county labels.
- **Address parsing is broken for most listings.** On 476 real addresses, 59% are now mixed case, and `cleanAddress`'s uppercase-only regexes return an empty street and city for every one of them. Every `AVENUE` address gets a city like `"Nue Stratford"`. Suffixes match inside words (`RUNNEMEDE` → street `"…Avenue Run"`, city `"Nemede"`). `startCase` turns house-number ranges like `40-42` into `40 42`.
- **HTML is entity-decoded before it is parsed.** `he.decode` runs on the whole document, which can turn escaped `<`, `>` and `"` in text back into markup. The S3 archive also stores this decoded copy rather than the page as served.

## What Changes

- Rewrite `parseListingDetails` for the `sale-detail-item` layout and `parseStatusHistory` to find the status table by its id and read cells by tag, not by child-node index. Both throw a clear "layout not recognised" error when their structure is missing, so a redirected or changed page fails loudly instead of producing an empty listing.
- Give each county its own HTTP client and session. A county run searches once, keeps the session cookie from that response, and fetches all of its listings' details through that client. The singleton goes away.
- Stop following redirects on details requests. A 302 becomes an error that says the session was rejected and names the `propertyId`.
- Fix Passaic's ID to `17`, and add the three NJ counties civilview lists that the scraper skips: Cape May (`52`), Middlesex (`73`) and Ocean (`85`). Add a test that county IDs are unique.
- Rewrite `cleanAddress`: split street from `City NJ zip` on the line break the details page provides, match case-insensitively on word boundaries as a fallback, keep hyphens and apostrophes, and take the ZIP from after `NJ`.
- Archive the raw HTML as served, and decode entities only in the text the parsers extract.
- Add parser, address and session tests built from sanitized copies of real civilview pages.

## Capabilities

### New Capabilities

- `civilview-scraping`: How the scraper talks to salesweb.civilview.com and turns its pages into listings. Covers the county ID map, per-county sessions, redirect handling, listing-detail and status-history parsing, address normalization, and what the S3 archive stores.

### Modified Capabilities

<!-- None: scraper-pipeline (fix-scraper-db-pipeline) covers orchestration, not page handling, and isn't archived yet. -->

## Impact

- Code: `backend/src/services/newJerseySheriffSale/` (`newJerseySheriffSaleHttpClient.ts`, `getCountyListingsHtml.ts`, `getListingDetailsHtml.ts`, `parseListingDetails.ts`, `parseStatusHistory.ts`, `cleanAddress.ts`, `cleanPropertyKey.ts`), `backend/src/services/constants/addressSuffix.ts`, `backend/src/types/njCounty.ts`, `backend/src/types/njSheriffSaleCountyIdMap.ts`, `backend/src/controllers/newJerseySheriffSaleScraper.ts` (passes each county's client through), and new tests and fixtures.
- Builds on `fix-scraper-db-pipeline`: this branch starts from it and reuses its limiter, `scrapeListing` / `saveListing` split, and best-effort archive.
- Dependencies: none added. `he` may become unused and can be removed.
- Data: Passaic listings appear for the first time, and three new counties add listings. Rows already in the DB labelled Passaic are really Gloucester listings; `listing-schema-fixes` repairs them.
- Still blocked after this change: every current `propertyId` exceeds Postgres `integer`, and `sheriffId` / `description` don't fit their columns, so writes keep failing until `listing-schema-fixes` lands.
