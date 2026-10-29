## Context

The sheriff-sale module scrapes every county from salesweb.civilview.com. Each county's run fetches a listings page and a details page per listing, builds a `ListingSnapshot` per details page (`buildListingSnapshot`), and syncs it with `syncListing`. A listing is identified by county and normalized sheriff number (`Listing_county_sheriffId_key`). `propertyId` is CivilView's per-session search ID: it's stored but isn't part of identity or of `contentHash` (`ingest/contentHash.ts:4`).

Ocean stopped publishing on CivilView after 2/27/2026. Its sheriff now publishes a "Foreclosure Listing" PDF, linked from https://sheriff.co.ocean.nj.us/frmForeclosures. The link seen on 2026-10-25 was `http://www.co.ocean.nj.us//WebContentFiles//3ec14ac4-25a1-41cd-8c8b-d9996a9d686c.pdf`, and HTTPS also serves it.

What that PDF looked like on 2026-10-25 (sha256 `8a3ac83a800e458a2518a11c5bb90aa3a6a8934aec3942ab11e316178894b337`). Every x and y below is in pdf.js coordinates, as unpdf's `getTextContent` reports them. A hand-written content-stream dump gave x values about 6pt smaller, and different items. An earlier draft used those numbers.

- **Size and layout:** 15 pages, PDF 1.4, 41,939 bytes. Every page has the same header (`OCEAN COUNTY`, `PAGE n`, `REAL ESTATE LISTING FOR 11/17/2026`, `UPSET AMOUNT`, `S`). The header items all sit at y≥758.16, and every listing item at y≤736.48. pdf.js merges `REAL ESTATE LISTING FOR` and `11/17/2026` into one item, but the content stream draws them separately, 0.16pt apart in y.
- **One sale date.** All 86 listings are for 11/17/2026.
- **Each listing is a block of seven lines:**

  ```
   CH    778323
                        PLAINTIFF U.S. BANK NATIONAL ASSOCIATION, SUC $604,809.38                             2
       F01582818        DEFENDANT GEORGE DUTCHER, ETC., ET AL
                        ATTORNEY STERN & EISENBERG, PC              609-397-9200
                                  ONJ20180000339    LUCAS ANDERSON
         SEQ      001    3139 CREEK ROAD                                                TOMS RIVER NJ 08753
                         Lot: 24                                 Block: 1108.31
  ```

- **The left columns.** Every listing item with x<60 is at one of four x positions: 18.76 (the sheriff-number prefix, `CH`), 30.00 (the docket), 41.96 (the six-digit sheriff number) and 45.92 (`SEQ`).
- **Rows are at fixed offsets.** In all 86 blocks, each item's y offset below the sheriff-number row is the same to within 0.05pt: 0, 15.76, 26.40–27.88, 38.24–41.20, 55.48–55.52, 75.12 and 89.36. A label and its value don't share a baseline: the `ATTORNEY` label sits 2.96pt above its value, and `DEFENDANT` 1.44pt above. CH 780707's status date sits at 27.76, 0.12pt above its defendant.
- **pdf.js splits and pads items.**
  - `SEQ 001` comes out as three items: `SEQ`, `" "` and `001`.
  - A street can be split: `1820 BAY TERRACE, BEACH`, `" "`, `HAVEN` (page 7).
  - The city line is three items: city (x=461.24), `NJ` and ZIP (both x>469).
  - 22 empty `""` items sit inside data rows, sharing the x and y of a real value.
  - Items arrive in content-stream order, column by column, not in reading order.
- **Sheriff number:** a prefix and six digits. There were 83 `CH` and 3 `L`, all distinct.
- **Docket:** usually `F` plus eight digits (`F01582818`), but 6 of 86 aren't: `L144917`, `DJ00099625`, `F448325`, `L00071725`, `F0085025`, `F1399125`.
- **SEQ:** every listing has `SEQ 001`, so each sheriff number has exactly one parcel.
- **Status column:** at x=469.08, on the plaintiff line. It held `CANCELLATION` (4), `PURCHASED` (1) and `ADJOURNED UNTIL` (1), and was blank for the other 80. The adjourned listing, `CH 780707`, carries its new date, `12/15/2026`, as a second status-column item on the defendant line.
- **`S` column:** at x=589.52. `1` or `2` for 54 listings, blank for the rest. It has no legend.
- **The phone has no column.** It follows the attorney name, wherever that ends: its x ranged from 372.24 to 473.56 across the 86 blocks. That overlaps the upset amount (384.56–408.56), the city (461.24) and the status column (469.08): the 11 `ROBERTSON ANSCHUTZ … PLLC.` phones sit at 473.56.
- **Optional rows:** 4 blocks have no attorney-file row, and 3 have no phone.
- **Truncation:** plaintiff and city are cut off at fixed widths (`… NATIONAL ASSOCIATIO`, `LITTLE EGG HARB NJ 08087`).
- **Zero upset:** one cancelled listing (`CH 780789`) shows `$0.00`.
- **No page splits.** No block in the fixture is split across a page break.

The Foreclosures page lists some links twice, once in a desktop list and once in a mobile list (`Conditions of Sale`, `Sample Deed`). `Foreclosure Listing` appeared once on 2026-10-25.

Prod has never stored an Ocean listing, so no existing Ocean row can collide with the new ones.

The frontend can't show Ocean listings yet, and this change doesn't try to:

- its county dropdown is the keys of `citiesByCountyMapping.ts`, which has no `Ocean` key;
- `pages/index.tsx:31–35` queries `constants.getCitiesByCountyMapping` and `listing.getListings`, but the routers are `constants.get` and `listing.list`.

## Goals / Non-Goals

**Goals:**

- Every daily run stores Ocean's current PDF listings with the same fields, identity and sync rules as other counties.
- Archive the source (the Foreclosures page and the PDF) byte for byte, as the CivilView pages are.
- An Ocean failure (link not found, download failed, layout not recognised, every write failed) fails the run and alarms, just as a county failure does.

**Non-Goals:**

- Replaying archived Ocean PDFs into the database.
- Expanding truncated plaintiff or city names.
- Interpreting the `S` column.
- Sold or redeemed outcomes beyond what the status column says.
- Showing Ocean on the frontend (see Context).

## Decisions

### D1. The Ocean source lives in the sheriff-sale module, as a second platform

Add the Ocean code to `modules/sheriffSale/`, in new folders that follow `clerkRecords`'s `platforms/press` layout:

- `scrape/platforms/oceanPdf/`: finding the link, downloading, archiving.
- `parse/platforms/oceanPdf/`: PDF rows to listing records.

Ocean produces the same `ListingSnapshot` and goes through the same `syncListing`, so it's the same domain pipeline with a second source, not a new module. The existing CivilView files stay where they are. Moving them under `platforms/civilview/` would be churn this change doesn't need.

_Alternative:_ a separate `modules/oceanPdf/`. That would mean importing `syncListing` and the snapshot types through `sheriffSale/index.ts`, widening that module's public surface for one county.

### D2. Find the PDF through the Foreclosures page each run

Fetch `https://sheriff.co.ocean.nj.us/frmForeclosures`, then find the anchors whose text is `Foreclosure Listing` (matched case-insensitively, with whitespace collapsed) and whose `href` ends in `.pdf`. Resolve each `href` against the page URL, collapse repeated slashes in the path, and upgrade `http:` to `https:`. If no anchor matches, or the matches resolve to more than one distinct URL, the Ocean run fails, naming the page.

The GUID file name probably changes whenever the sheriff updates the listing, so a hard-coded PDF URL would quietly freeze on an old list.

An earlier draft failed on any second match. That's wrong: the page already repeats other links in its mobile list, and a repeated `Foreclosure Listing` link to the same PDF isn't ambiguous.

The client is a small `HttpClient` subclass in `scrape/platforms/oceanPdf/`, built like `NewJerseySheriffSaleHttpClient`, with a 30 s timeout. The sheriff-sale module has no user-agent constant, and borrowing `clerkRecords`'s would cross a module boundary, so the client sends axios's default. `HttpClient` adds an empty `Authorization: Bearer` header to every request, as it already does for CivilView. The local run (task 7.2) shows whether either county host minds.

### D3. Archive the page and the PDF under one prefix, before parsing

Each run writes two objects to `nj-sheriff-sale`:

- `ocean-pdf-files/<YYYY-MM-DD>/foreclosures.html`: the Foreclosures page, as served.
- `ocean-pdf-files/<YYYY-MM-DD>/foreclosure-listing.pdf`: the PDF, byte for byte, with `ContentType: application/pdf`.

`saveS3` takes `data: string | Uint8Array` and an optional `contentType`, so the PDF isn't decoded as text. Archiving is best effort, as `scraper-pipeline`'s "Best-effort HTML archive" requires: a failed save is logged and the run continues. The date is `todaysArchiveDate()`, the same snapshot date the CivilView pages use. A later replay can rebuild every Ocean snapshot from this prefix alone.

The Foreclosures page is archived as soon as it's fetched, before the link is looked for, so a run that fails on "link not found" or a failed PDF download still keeps the page that explains it. The PDF archive is awaited before parsing starts, and the parser gets its own copy of the bytes (D4). pdf.js transfers the buffer it's given to its worker, which detaches the caller's `ArrayBuffer`. A save that ran during or after parsing, on the same bytes, would upload 0 bytes.

### D4. Parse positioned text with unpdf

Use `unpdf`'s pdf.js document API, not its `extractText` helper, which flattens away the positions:

1. Call `getDocumentProxy(new Uint8Array(bytes))`. pdf.js rejects a Node `Buffer` ("Please provide binary data as `Uint8Array`, rather than `Buffer`"), and axios returns a `Buffer` for an `arraybuffer` response. The copy also leaves the archived bytes intact (D3).
2. Call `page.getTextContent()` for each page, and take each item's text with its x (`transform[4]`) and y (`transform[5]`).
3. Drop every item whose text is blank once trimmed (`""`, `" "`). They carry no data, and they share positions with real values.
4. Split off the page-header items by position: everything at or above a header boundary (`HEADER_MIN_Y`, between the 736.48 and 758.16 measured in Context). Read the sale date from them by joining the header items on each line (within 2pt of y, sorted by x) and matching `REAL ESTATE LISTING FOR (\d{1,2}/\d{1,2}/\d{4})` on the joined text. pdf.js merges that line into one item today, but the content stream draws it as two, so the parser mustn't depend on the merge.
5. Sort the remaining items by y, top first, then x. pdf.js returns them in content-stream order, column by column.
6. Split them into blocks and rows (D5).

The position constants come from the fixture during the spike (task 1.2), not from runtime inference:

- the header boundary;
- the prefix column's x range (the sheriff-number prefix at 18.76, left of the docket at 30.00);
- each row's offset band below the sheriff-number row (D5);
- the status (469.08), `S` (589.52) and city (461.24) x thresholds, and the SEQ/street boundary on the `SEQ` row (100: SEQ ends at 81.92, streets start at 113.60).

`pdftotext -layout` isn't available in Lambda, and its line-based output already misplaces fields in this PDF: upset amounts end up on their own lines, and the status column drifts by a few characters. pdf.js gives each text run's position. Oracle Reports draws the page column by column, so no two neighbouring fields share a text item.

An earlier draft matched header rows by substring (`PAGE`, `AMOUNT`, `OCEAN COUNTY`). That would drop data rows: the fixture has the city `OCEAN TOWNSHIP`, `PARAMOUNT` contains `AMOUNT`, and prod already has defendants and streets containing `PAGE`.

_Alternatives:_

- `pdf-parse`: wraps pdf.js 1.10 from 2018 and is unmaintained.
- `pdf2json`: workable, but its coordinate units are less direct.
- `unpdf` ships a serverless pdf.js build that bundles with esbuild into one CJS file, and it needs no worker or canvas. In the CJS bundle, `import.meta` becomes `{}`, so unpdf can't locate pdf.js's standard fonts. pdf.js logs a warning for each one, such as Courier-Bold, but text positions come from the content stream and are unaffected.

### D5. Blocks start at the prefix column; rows are read by offset band and by span

**Blocks.** An item in the prefix column (x<25; the prefix is at 18.76, and the docket, the next column, at 30.00) starts a block. A block runs to the next prefix-column item or the end of the page. Its sheriff-number row (band 0) must hold exactly a 1–3 letter prefix (`^[A-Z]{1,3}$`) and a six-digit number (at 41.96). If it doesn't (a seven-digit number, or something unexpected), the block fails (D7). It is never folded into the previous block, which would quietly corrupt a different listing.

An earlier draft started a block at any item with x<40. That catches every docket (x=30.00), which would split each listing in two and fail all of them. It also left the sheriff number itself (x=41.96) out of the column.

**Page breaks.** A block must lie on one page: one that reaches the page's end before its `Lot:`/`Block:` row fails (D7). Items on a page above its first block's prefix item, which is where the tail of a split block would land, form one failed block of their own. That block counts toward `found`, so the under-half rule (D8) sees it. No block in the fixture is split, and Oracle Reports appears to keep each group together. Joining a split block would need its offsets re-based across pages, for a case not yet seen. An earlier draft said blocks join across page breaks. It no longer does.

**Rows.** Each item is assigned to a row by its y offset below the sheriff-number row. The bands are ranges with wide gaps between them, not tolerances around the measured offsets:

| Row                      | Measured offsets | Band     |
| ------------------------ | ---------------- | -------- |
| sheriff number           | 0                | −2 to 2  |
| `PLAINTIFF`              | 15.76            | 13 to 18 |
| docket + `DEFENDANT`     | 26.40–27.88      | 24 to 31 |
| `ATTORNEY`               | 38.24–41.20      | 36 to 44 |
| attorney file (optional) | 55.48–55.52      | 53 to 58 |
| `SEQ`                    | 75.12            | 73 to 77 |
| `Lot:` / `Block:`        | 89.36            | 87 to 92 |

An item in no band fails the block. The band for the defendant row has to hold CH 780707's status date at 27.76 as well as the label at 26.40 and the value at 27.88. Grouping by a y tolerance was rejected: a label sits up to 2.96pt above its value.

**Fields within a row.** Within a row, items are sorted by x. Status and `S` items are taken out first, then each field is read as a span: every item between two markers, joined with a space. There are no global x columns, because the phone has none.

| Row               | Fields                                                                                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sheriff number    | `sheriffId` = prefix + number (`CH 778323`, normalized to `CH778323` by `normalizeSheriffId`)                                                                                                                                                                                                               |
| `PLAINTIFF`       | status: items at 469 ≤ x < 589. `S`: items at x ≥ 589 (ignored). `plaintiff`: the items after the label, before the first `$` item. `upsetAmount`: that `$` item                                                                                                                                            |
| `DEFENDANT`       | status: items at 469 ≤ x < 589. `courtCase`: the item left of the label, as printed, with no pattern check. `defendant`: the items after the label                                                                                                                                                          |
| `ATTORNEY`        | no x threshold. `attorneyPhone`: the last item, when it matches `^\d{3}-\d{3}-\d{4}$` (optional). `attorney`: the items after the label, before the phone                                                                                                                                                   |
| attorney file     | ignored, as CivilView's `attorneyFile` is                                                                                                                                                                                                                                                                   |
| `SEQ`             | SEQ: the items at x < 100, joined and matched with `^SEQ (\d+)$`. Street: the items at 100 ≤ x < 461. City line: every item at x ≥ 461 (`TOMS RIVER`, `NJ`, `08753`)                                                                                                                                        |
| `Lot:` / `Block:` | each value is one item that carries its label (`Lot: 24`, `Block: 1108.31`). The row must be a `Lot:` item followed by a `Block:` item. `parcel` = `LOT <lot> BLOCK <block>`, with `^Lot:\s*` and `^Block:\s*` stripped. The values are free text (`26, 27, 28, 29`, `507 FKA 507`) and are kept as printed |

`address` is the street and the city line joined with a newline, so `parseAddress` splits it. pdf.js can split a street (`1820 BAY TERRACE, BEACH` + `HAVEN`), which is why every field is a span.

**Status.** The status is the status items from the `PLAINTIFF` and `DEFENDANT` rows, in that order, joined with a space: `ADJOURNED UNTIL 12/15/2026` for `CH 780707`. That matches CivilView, whose adjourned rows carry the new sale date in the status text. The x range is limited to those two rows because other rows have items past 469: the city line's `NJ` and ZIP in every block, and the 11 phones at 473.56. An earlier draft took "every status-column item in the block", which would have made every listing's status its state and ZIP.

**SEQ.** A block with more than one `SEQ` row, or a SEQ other than `001`, fails (D7). A second parcel under the same sheriff number would collide on the `(county, sheriffId)` identity. The record carries `seq` so the fixture test can check it, and the snapshot builder drops it.

**Missing rows.** A block with no `PLAINTIFF`, `DEFENDANT`, `ATTORNEY`, `SEQ` or `Lot:`/`Block:` row fails.

**Sale date.** `saleDate` comes from the page header's `REAL ESTATE LISTING FOR <M/D/YYYY>`. Every page must carry the same date, or the layout fails (D8). The parser returns it as printed (`11/17/2026`), and `oceanListingPage` (D7) puts it in both the listing's `saleDate` and its status row's date. `validateListingDetails` and `validateStatusHistory` both take `M/D/YYYY` and store an ISO date. Passed an ISO date, they would drop it with a warning.

### D6. Status history: one row per snapshot, dated the sale date

Each snapshot carries exactly one status row, dated the listing's `saleDate`. Its status is the D5 status text, title-cased by `ingest/oceanListingPage.ts` (`Cancellation`, `Purchased`, `Adjourned Until 12/15/2026`), or `Scheduled` when the status column is blank. `normalizeStatus` only collapses whitespace, so the title-casing has to happen there. The existing merge rules then apply: a new (status, date) pair inserts a row, and a repeated pair widens `firstSeenOn` and `lastSeenOn` (`syncListing.ts:89–98`).

Over time this records what CivilView's history shows: a listing first `Scheduled` for 11/17, then perhaps `Adjourned Until 12/15/2026` on 11/17, then `Scheduled` for 12/15 when a later PDF lists it under the new date. `Scheduled` is also the most common status CivilView gives in prod (4,940 rows).

### D7. Per-listing isolation and identity

A block that fails D5's rules is logged with its page number and its first row's text, and skipped. It doesn't stop the others. This mirrors `scraper-pipeline`'s "Per-listing failure isolation", with page and first row in place of a `propertyId`.

Ocean snapshots are built by the existing `buildListingSnapshot`, not a copy of it. Its `propertyId` argument becomes `number | null`. The Ocean pipeline passes:

- `page.listing`: the record's listing fields, plus `saleDate` as printed (`11/17/2026`), and without `status` or `seq`, which `validateListingDetails` would warn about as "not a listing field" (`listingSchema.ts:214–216`);
- `page.statusHistory`: one row, with the D6 status and the same `M/D/YYYY` date, which `validateStatusHistory` converts (it rejects an ISO date);
- `propertyId: null`.

An earlier draft had a separate `buildOceanListingSnapshot`. That would have duplicated the validation, normalization and hashing, and invited all three mistakes above.

Identity is unchanged: county `Ocean` plus the normalized sheriff number. `SnapshotListing.propertyId` becomes `number | null`. `syncListing` writes `propertyId` as it already does. A NULL `propertyId` never conflicts with anything, because no index covers the column.

### D8. Ocean's failure rule, shared with the counties

Move `pipeline.ts`'s sync-and-summarize tail (lines 113–162) into one helper, `syncCountySnapshots`, also in `pipeline.ts`. It calls `saveListing`, which lives there, and no stage may import from `pipeline.ts`. It takes the county, the found count, the snapshots and the field-warning count, and it:

- rejects when listings were found but none parsed;
- writes the parsed snapshots;
- rejects when every write failed;
- rejects when fewer than half parsed, after the writes;
- logs `Synced <county> County: …`.

CivilView counties and Ocean both call it, so the rules can't drift apart. `ListingFieldWarning.propertyId` (`pipeline.ts:17`) becomes `number | null`, and the field-warning and failed-parse log lines name the sheriff number when it's NULL.

The Ocean run rejects when any of these happens:

- the Foreclosures page or the PDF can't be fetched;
- the link isn't found, or the matching links point at different PDFs (D2);
- the PDF has no `REAL ESTATE LISTING FOR` header, or its pages disagree on the date;
- the PDF has no listing blocks;
- no listing block parses;
- every listing write fails;
- fewer than half the blocks parse. The parsed ones are written first.

An earlier draft left out the "every write fails" rule. Without it, the failure most likely on the first deploy would have looked like success: the migration not yet applied, so every insert hits the NOT NULL. Ocean would have resolved with "failed writes 86", and no alarm would have fired.

A PDF with a valid header and zero blocks is a failure, not "found 0". Ocean held 86 listings when this was written, and an empty PDF is far more likely to be a layout change than a week with no sales. If Ocean really does have a week with no sales, the alarm costs one look.

### D9. Handler and county lists

`NJ_COUNTIES` (in `shared/nj`) stays the full list. `clerkRecords/handler.local.ts` and replay's `--county` parsing use it. The sheriff-sale module gets `CIVILVIEW_COUNTIES`, `NJ_COUNTIES` without Ocean, and a `CivilViewCounty` type. These move to that type:

- `NJSheriffSaleCountyIdMap: Record<CivilViewCounty, string>`, so Ocean has no CivilView ID;
- `getCountyListingsHtml`'s `county`;
- `newJerseySheriffSaleCountyParser`'s `county`.

The handler builds one list of runs: `{ county, run }` for each CivilView county, plus `{ county: 'Ocean', run: oceanPdfParser }`. It passes those to `Promise.allSettled`, and it names failed counties from that list, not by index into `NJ_COUNTIES`. A rejected Ocean run is reported as county `Ocean` in the "failed for N/17 counties" error. The count stays 17.

Replay defaults to `CIVILVIEW_COUNTIES` when no `--county` is given, since replay can't read Ocean's PDF yet. Otherwise every replay of a date after this change would count Ocean's county page as missing. `--county Ocean` still works for the empty CivilView pages archived before this change.

The Lambda never retries an async invoke (`maximum_retry_attempts = 0`, `infra/scraper.tf:107`). A thrown error marks the invocation failed, and the errors alarm and the DLQ pick it up.

### D10. Migration: drop the leftover NOT NULL on `propertyId`

Add `<NNNN>_drop_listing_property_id_not_null.sql`, a custom migration made with `drizzle-kit generate --custom`, at the next free number when it's generated (`0014` on 2026-10-25; `add-njparcels-lookup` may take it first):

```sql
ALTER TABLE "Listing" ALTER COLUMN "propertyId" DROP NOT NULL;
```

It's expand-only. The running code always sets `propertyId`, and the Drizzle schema already declares the column nullable, so the snapshot doesn't change and CI's drift check passes. This is the same fix as `0013_drop_listing_address_not_null.sql`. Prod's `information_schema` shows `Listing.propertyId` with `is_nullable = NO` today.

`listing-storage`'s "One listing per property ID" has been stale since `0009` dropped `Listing_propertyId_key`. This change removes it, and adds `propertyId` to that spec's nullable columns.

### D11. `$0.00` stays 0

`validateListingDetails` turns `$0.00` into 0, as it does for CivilView, and this change keeps that. A cancelled listing shows `$0.00`. Storing it as NULL would need a rule that Ocean's money values don't share with CivilView's. The status row already says the listing was cancelled.

## Risks / Trade-offs

- **The sheriff changes the PDF layout.** The position constants break, and the fixture test no longer matches live PDFs. → D8 fails the run on a missing header, no blocks, or under half of the blocks parsing, so the alarm fires the first day. The archived PDF is the fixture for the fix.
- **A block split across a page break.** → D5 fails that block, and D8's under-half rule bounds the damage. If the archive shows splits, join them in a later change.
- **Truncated plaintiff and city names.** They're stored as the PDF prints them (`LITTLE EGG HARB`). → Accepted for now. A later change can expand truncated city prefixes against a list of Ocean towns.
- **Limited coverage window.** If the PDF only ever lists the next sale date, a listing appears days or weeks before its sale and drops off after it, so Ocean listings will have shorter histories than CivilView ones. → Accepted. Daily archives will show how often the PDF changes; see Open Questions.
- **No sold status.** A listing that drops off the PDF keeps its last status. → It's the same as a CivilView listing that disappears. The status-column values (`PURCHASED`) cover the cases the PDF reports.
- **Bundle size.** A minimal unpdf entry bundles to 2.3 MB unminified with the repo's esbuild flags. On top of the current 3.7 MB `dist/index.js`, that's about 6 MB, well under Lambda's limits. Task 1.3 measures the real bundle.
- **Tests run a different build than Lambda.** Vitest loads unpdf's ESM build, and Lambda runs the esbuild CJS bundle. → Task 1.3 runs the built bundle under Node 24 against the fixture.
- **The county site is slow or down.** → The fetches get a timeout (30 s). A failure fails only Ocean, and the other 16 counties still sync.
- **Extra dependency surface.** → `unpdf` is pinned to an exact version, as every dependency here is. It runs only on a PDF from a county government site, and its output is checked by the parser's shape checks.

## Migration Plan

1. Merge. CI applies the custom migration (drop NOT NULL on `propertyId`) before the deploy. The running code always sets `propertyId`, so the migration is safe on its own.
2. Deploy. The next 00:00 UTC run scrapes CivilView without Ocean, and adds Ocean from the PDF.
3. Verify in that run's logs and in prod:
   - an `Ocean` summary line with `found` equal to the PDF's block count, and no failed writes;
   - Ocean rows with `propertyId` NULL;
   - one status row per listing.
4. Rollback: revert the code. The migration can stay, since a nullable `propertyId` is harmless to the old code. Ocean rows already written can be kept. To delete them, delete their status rows first, then the listings. `StatusHistory.listingId` has no foreign key, so deleting only the listings would leave orphaned status rows:

   ```sql
   DELETE FROM "StatusHistory" WHERE "listingId" IN (SELECT id FROM "Listing" WHERE county = 'Ocean');
   DELETE FROM "Listing" WHERE county = 'Ocean';
   ```

## Open Questions

- What is the `S` column? Possibly the number of times the listing has been offered or adjourned. The sheriff's "Conditions of Sale" and "Foreclosure Sales Announcements" PDFs may say. It isn't stored until it's known.
- How often does the PDF change, and does it ever list more than one sale date? D5 fails the layout on mixed dates. If multi-date PDFs turn out to be normal, read `saleDate` per page instead, which is a small change.
- Does Oracle Reports ever split a block across pages? D5 fails such a block for now.
