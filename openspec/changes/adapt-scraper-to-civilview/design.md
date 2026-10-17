## Context

The scraper (`backend/`) fetches each county's listings page from salesweb.civilview.com, then each listing's details page, and parses them into `Listing` and `StatusHistory` rows. `fix-scraper-db-pipeline` (this branch's base) made the run bounded and failure-isolated, but the page handling underneath is out of date. What the site does today (verified with direct requests on 2026-10-17):

```
GET /Sales/SalesSearch?countyId=17     → 200, Set-Cookie: ASP.NET_SessionId=…  (session now "on" Passaic)
GET /Sales/SaleDetails?PropertyId=P1   → 200 with that cookie, when P1 is a Passaic listing
                                       → 302 Location: / with that cookie, when P1 is another county's listing
                                       → 302 Location: / with no cookie
GET /Sales/SalesSearch?countyId=19     (same cookie) → session switches to Gloucester; Passaic details now 302
```

The `AWSALB` load-balancer cookie isn't needed; `ASP.NET_SessionId` alone works.

The details page markup:

```html
<div class="sale-details-list">
  <div class="sale-detail-item">
    <div class="sale-detail-label">Sheriff #&colon;</div>
    <div class="sale-detail-value">F-23001318   </div>
  </div>
  … Court Case #, Sales Date, Plaintiff, Defendant,
    Address (street<br/>City NJ 07512), Description (~3,000 chars of notice text),
    Approx. Upset* or Approximate Judgment, Attorney, Parcel #, Property Note …
</div>
<table class="table table-striped " id="longTable">
  <thead><tr><th>Status</th><th>Date</th><th id="collapse">…</th></tr></thead>
  <tr><td>Scheduled</td><td>9/19/2023</td></tr> …
</table>
```

Labels vary by county (some show `Approx. Upset*`, some `Approximate Judgment`) and may include ones the schema doesn't store (`Property Note`). Addresses come in both upper and mixed case depending on the county.

The county listings page still works with today's parser: its last `<table>` has one row per listing, and the first cell's `<a href="/Sales/SaleDetails?PropertyId=…">` carries the ID.

Constraints: no new runtime dependencies; node-html-parser 5 is already available; tests run in Jest with the HTTP layer stubbed (`getListingDetailsHtml.test.ts` on the base branch shows the in-process axios adapter pattern).

## Goals / Non-Goals

**Goals:**

- Every county's listings parse from today's pages, with the right county label.
- A page the parser doesn't recognise (redirect, error page, layout change) fails that listing with an error that says so.
- Addresses split into street, city and ZIP correctly for both upper- and mixed-case input.
- The S3 archive keeps the page exactly as served.

**Non-Goals:**

- DB schema changes and data repair (`propertyId` type, `sheriffId` / `description` column types, unique index, relabelling Passaic rows). These belong to `listing-schema-fixes`.
- Updating listings that already exist; the insert-only behavior stays.
- Re-establishing a session mid-run when it expires. A county run takes minutes, and ASP.NET's default session timeout is 20 minutes. If it does expire, the affected listings fail with the session error and the Lambda retry covers it.
- Scraping sold or cancelled listings (`IsOpen=false`).
- General HTTP client clean-up (the empty `Authorization` header, `withCredentials`), beyond what per-county sessions need.

## Decisions

### 1. One HTTP client and session per county

`NewJerseySheriffSaleHttpClient` stops being a singleton: remove `instance`, `createClient` and `getClient`. `newJerseySheriffSaleCountyParser` creates a client at the start of each county run and passes it to `getCountyListingsHtml(client, county)` and, through `scrapeListing`, to `getListingDetailsHtml(client, { propertyId })`. The client stores the `ASP.NET_SessionId` from the search response and sends it on every later request. Because each county has its own client, counties running in parallel no longer overwrite each other's session. The shared listing limiter is unchanged.

- _Alternatives:_ run counties one after another on a single session (simpler, but throughput drops and the limiter is pointless); `axios-cookiejar-support` with one jar per county (works, but a dependency for one cookie the client already handles).
- Keep the 30 s request timeout `fix-scraper-db-pipeline` adds to the client (its task 2.5). If this branch was cut before that commit, it comes in on rebase.

### 2. Redirects are errors

Details requests set `maxRedirects: 0`. With axios's default `validateStatus`, a 302 rejects. `getListingDetailsHtml` turns a 3xx into `Error("Session rejected for propertyId <id>: redirected to <location>")`. Today the redirect is followed silently and the home page reaches the parser, which produces a misleading `TypeError`.

### 3. Parsers target the current markup and fail when it's missing

- `parseListingDetails` reads every `.sale-detail-item`, takes the label from `.sale-detail-label` and the value from `.sale-detail-value`, and maps the label through `cleanPropertyKey`. A label that isn't one of the accepted keys is logged once and left out of the result. If the page has no `.sale-detail-item`, it throws `Listing details layout not recognised`.
- Values are the element's entity-decoded text (`.text` in node-html-parser), with whitespace runs collapsed and trimmed, except that `<br>` becomes a newline first, so the address keeps its street / city line break. Every other field collapses newlines to spaces.
- `parseStatusHistory` finds `table#longTable`, falling back to the table whose header row reads Status and Date. For each body row that has `td` cells, it takes the first cell as `status` and the second as `date`, selected with `querySelectorAll('td')` rather than `childNodes` indexes, which only worked because of whitespace text nodes. No table → throw `Status history layout not recognised`. A table with no rows returns `[]`.
- `sheriffId` stays the string the site shows (`F-23001318`). The column becomes text in `listing-schema-fixes`; until then that insert fails, which is already true.

### 4. Raw HTML in, decoded text out

`getCountyListingsHtml` and `getListingDetailsHtml` stop calling `he.decode`. They archive and return `response.data` as served. Parsers decode only the text they extract. Remove `he` and `@types/he` if nothing else uses them.

### 5. County IDs

Set `Passaic: '17'` and add `'Cape May': '52'`, `Middlesex: '73'`, `Ocean: '85'` to both `NJ_COUNTIES` and `NJSheriffSaleCountyIdMap`. Type the map as `Record<NJCounty, string>`, so a county without an ID is a compile error. A test asserts the IDs are unique. The S3 key for the county page uses `county.toLowerCase()`, so `Cape May` needs a slug (`cape-may-county.html`).

- These 17 counties are the full NJ list on the civilview home page as of 2026-10-17. The other four NJ counties publish elsewhere.

### 6. `cleanAddress`

The input is the parsed address value, usually `"<street>\n<City> NJ <zip>"`.

1. Split on the last newline. The last line is matched with `/^(.*?),?\s+NJ\s+(\d{5})(?:-\d{4})?$/i`: group 1 is the city and group 2 the ZIP. Everything before it is the street line.
2. If there's no newline, or the last line doesn't match, fall back to one regex over the single-line form: street ending in a known suffix, then city, then `NJ`, then ZIP. Suffixes are matched case-insensitively and on word boundaries (`\b(?:AVENUE|AVE|STREET|ST|…)\b`), longest alternatives first, so `AVENUE` never matches as `AVE` and `RUNNEMEDE` never matches `RUN`. Add the common USPS abbreviations (`ST`, `RD`, `DR`, `LN`, `CT`, `BLVD`, `PL`, `TER`, `CIR`, `HWY`, `TPKE`).
3. Unit: `/\b(?:UNIT|APT|SUITE|STE)\b[.\s#]*([0-9A-Z-]+)/i` on the street line, or a `#` followed by a token. Secondary unit: `/\b(BUILDING|BLDG|ESTATE)\b[\s#]*([0-9A-Z]+)/i`; the old `[s#]` was a typo for `[\s#]`.
4. Title-case the street, city and units with a small helper that lowercases the whole string, then uppercases the first letter of each space-separated word. It keeps hyphens, apostrophes and digits, so `40-42 MYRTLE STREET` → `40-42 Myrtle Street` and `O'NEIL` → `O'neil`. lodash's `startCase` strips that punctuation, so it goes.
5. `address` is the full value on one line (newlines → single spaces), trimmed. That matches today's stored format.

Remove the dead lines 22–29 and the commented-out `parse-address` import. Remove `parse-address`, its `.d.ts` and the unused `COUNTY_CITIES` constant if nothing else uses them.

### 7. Tests from real pages, sanitized

Build fixtures from real civilview pages, trimmed to the relevant markup. Replace party names, attorney names, and the description notice text with placeholders: the pages are public records, but this repo shouldn't carry real people's names. Reference pages saved during exploration are at `/private/tmp/claude-502/-Users-vrama-projects-sheriff-sale/e5549906-ffe8-4a92-87cc-5d1d0a79dd86/scratchpad/html/`: `d1.html` (Passaic details, mixed-case address), `d2.html` (Gloucester details, upper-case address, `Approximate Judgment`), `passaic.html` (county listings page). If they're gone, fetch fresh ones with a few read-only GETs (search a county first, then send its `ASP.NET_SessionId` on the details request). Keep fixtures under `backend/src/services/newJerseySheriffSale/__fixtures__/`.

## Risks / Trade-offs

- [The site changes layout again] → The parsers now throw a named error instead of producing junk, and the county failure rule from `fix-scraper-db-pipeline` turns that into a Lambda error. Fixture tests make the next update quick.
- [The site starts requiring the `AWSALB` cookie (sticky sessions)] → The per-county client can store and send it the same way as `ASP.NET_SessionId`. It isn't needed today.
- [Three new counties add load and new layout variants] → Each is one more search, plus its listings through the same 8-slot limiter. A county whose pages don't parse fails on its own and is named in the run error.
- [Mixed-case addresses with no line break and an unknown suffix still get no street or city] → `address` always keeps the full text; only the split fields stay empty.
- [The first successful run inserts a Passaic backlog] → Expected, once `listing-schema-fixes` has also landed.

## Migration Plan

Merge after `fix-scraper-db-pipeline`; this branch is cut from it. Writes still fail until `listing-schema-fixes` lands (see Non-Goals), so the expected sign after deploy is per-listing failures caused by DB errors (`out of range for type integer`, `value too long`) rather than parse `TypeError`s or session redirects. Rollback: redeploy the previous commit.

## Open Questions

- None blocking.
