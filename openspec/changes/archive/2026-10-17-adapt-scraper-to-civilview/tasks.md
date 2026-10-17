## 1. Fixtures

- [x] 1.1 Build sanitized fixtures under `backend/src/services/newJerseySheriffSale/__fixtures__/` from real civilview pages (design Decision 7): a details page with a mixed-case address and `Approx. Upset*`, a details page with an upper-case address and `Approximate Judgment`, a county listings page trimmed to a few rows, and the home page (what a 302 leads to). Replace party names, attorney names and description notice text with placeholders.

## 2. County IDs

- [x] 2.1 Set `Passaic: '17'` and add `Cape May` (52), `Middlesex` (73) and `Ocean` (85) to `NJ_COUNTIES` and `NJSheriffSaleCountyIdMap`. Type the map as `Record<NJCounty, string>`.
- [x] 2.2 Make the county-page S3 key a slug (`cape-may-county.html`).
- [x] 2.3 Add `njSheriffSaleCountyIdMap.test.ts`: every county has an ID, all IDs are unique, and Passaic is 17.

## 3. Per-county session and redirects

- [x] 3.1 Remove the singleton from `NewJerseySheriffSaleHttpClient` (`instance`, `createClient`, `getClient`). The client stores the `ASP.NET_SessionId` from responses and sends it on later requests. Keep the 30 s request timeout from `fix-scraper-db-pipeline` (rebase onto it if this branch predates that commit).
- [x] 3.2 Change `getCountyListingsHtml(client, county)` and `getListingDetailsHtml(client, { propertyId })` to take the client. In `newJerseySheriffSaleCountyParser`, create one client per county run and pass it through `scrapeListing`. Update the controller tests.
- [x] 3.3 Set `maxRedirects: 0` on details requests, and turn a 3xx into an error naming the `propertyId` and the redirect location.
- [x] 3.4 Tests with the in-process axios adapter stub: two clients keep separate session cookies; a details request sends its own client's session; a 302 rejects with the session-rejected error and the body is never parsed.

## 4. Raw HTML

- [x] 4.1 Remove `he.decode` from `getCountyListingsHtml` and `getListingDetailsHtml`. Archive and return the HTML as served. Remove `he` and `@types/he` from `backend/package.json` if nothing else uses them. Update `getListingDetailsHtml.test.ts`.

## 5. Parsers

- [x] 5.1 Rewrite `parseListingDetails` for `.sale-detail-item` / `.sale-detail-label` / `.sale-detail-value` (design Decision 3). Use decoded text, keep the address `<br>` as a newline, collapse other whitespace, drop and log non-listing labels, and throw `Listing details layout not recognised` when no items exist.
- [x] 5.2 Rewrite `parseStatusHistory`: find `table#longTable` (fall back to the Status / Date header), read `td` cells by tag, return `[]` for no rows, and throw `Status history layout not recognised` when the table is missing.
- [x] 5.3 Replace `parseListingDetails.test.ts` with fixture-based tests covering both details fixtures, the unknown-label case and the home page throwing. Add `parseStatusHistory.test.ts`: fixture rows, minified rows (no whitespace between cells), and the missing table.

## 6. Address normalization

- [x] 6.1 Rewrite `cleanAddress` per design Decision 6: split on the line break, the case-insensitive word-boundary suffix fallback (longest first, plus USPS abbreviations in `ADDRESS_SUFFIX`), ZIP after `NJ`, the fixed unit and secondary-unit regexes, and a title-case helper that keeps hyphens and apostrophes. Remove the dead code and the `parse-address` import. Remove `parse-address`, its `.d.ts`, and `COUNTY_CITIES` if unused.
- [x] 6.2 Add `cleanAddress.test.ts` with every spec scenario, plus `1020 North New Road\nPleasantville NJ 08232`, `17 Granada Drive\nParsippany - Troy Hills NJ 07054`, and a unit (`12 MAIN ST UNIT 4B …`).

## 7. Verification

- [x] 7.1 In `backend/`, run `npm run build`, `npm test` and `npm run lint` and fix any failures. Don't run the scraper locally (it writes to the prod bucket and DB), don't invoke the Lambda, and don't import `@sheriff-sale/database` outside mocked tests (its client loads the repo's `.env`).
- [x] 7.2 Run `openspec validate adapt-scraper-to-civilview --strict` and fix any issues.
