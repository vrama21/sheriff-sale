## 1. Fixtures and spike

- [ ] 1.1 Save the Foreclosures page and the Foreclosure Listing PDF byte for byte into `modules/sheriffSale/__fixtures__/oceanPdf/` (`foreclosures.html`, `foreclosure-listing-2026-11-17.pdf`). Use the 2026-10-25 PDF, whose sha256 design.md records, since every expectation in 3.3 comes from it. A fresh capture qualifies only if its hash matches. The 2026-10-25 Foreclosures page was captured during review (37,556 bytes). Add a `readOceanFixture` helper that returns a fresh `Uint8Array` on each call, not a `Buffer`, because pdf.js rejects a `Buffer` and detaches what it's given (D4).
- [ ] 1.2 Spike: add `unpdf` at an exact version to `backend/package.json`, and dump the fixture's text items with their `transform[4]`/`transform[5]` coordinates. Record these as constants in the parser, and note them in this file:
  - the header boundary (`HEADER_MIN_Y`);
  - the prefix column's x range (D5);
  - the row bands (D5's table);
  - the status (469.08), `S` (589.52) and city (461.24) x thresholds, and the SEQ/street boundary (100);

  Use pdf.js's own coordinates, not a content-stream dump: they differ by about 6pt. Check every one of the 86 blocks against the constants.

- [ ] 1.3 Run `npm run build` in `backend`, and record `dist/index.js`'s size before and after `unpdf` (a minimal unpdf bundle measured 2.3 MB). Then run the built bundle, not the Vitest ESM build, under Node 24 against the fixture: it should parse 86 records with no worker and no canvas. Expect pdf.js standard-font warnings (D4).

## 2. Find, fetch and archive

- [ ] 2.1 Add `scrape/platforms/oceanPdf/findForeclosureListingUrl.ts`. Parse the Foreclosures page with `node-html-parser`, match the `Foreclosure Listing` anchors (D2), and resolve each `href`: de-duplicate slashes, upgrade to HTTPS. Then de-duplicate the resolved URLs. Test it with:
  - the fixture;
  - a page with no match;
  - a page with two anchors to the same PDF (passes);
  - a page with anchors to two different PDFs (fails).
- [ ] 2.2 Add `scrape/platforms/oceanPdf/oceanPdfHttpClient.ts`, an `HttpClient` subclass with a 30 s timeout (D2). It fetches the Foreclosures page as text, and the PDF as an `arraybuffer`, returned as a `Uint8Array`. Test it against a stubbed client.
- [ ] 2.3 Widen `shared/s3/saveS3.ts` to take `data: string | Uint8Array` and an optional `contentType`. Add a test that a `Uint8Array` reaches `PutObject` unchanged, with its content type.
- [ ] 2.4 Add `scrape/platforms/oceanPdf/archiveOceanPdf.ts`, with one function per object: `foreclosures.html`, and `foreclosure-listing.pdf` (`application/pdf`), under `ocean-pdf-files/<todaysArchiveDate()>/`. Saves are best effort, logging a failed save. Test both saves and the failure path.

## 3. Parse

- [ ] 3.1 Add `parse/platforms/oceanPdf/pdfTextItems.ts`. It calls `unpdf`'s `getDocumentProxy` on a copy of the bytes (`new Uint8Array(bytes)`), and returns each page's non-blank text items with x, y and page number. It returns header items, split off at `HEADER_MIN_Y`, separately from data items, which are sorted by y, top first, then x (D4). Test it on the fixture: page count, the first page's header items, no blank items, and that the input bytes are unchanged afterwards.
- [ ] 3.2 Add `parse/platforms/oceanPdf/parseOceanListingPdf.ts`. It:
  - reads the sale date from every page's joined header line (D4), and requires the pages to agree;
  - splits blocks at prefix-column items (x<25, D5);
  - assigns rows by D5's bands, sorts each row by x, and reads each field as a span (D5's field table);
  - takes status items only from the plaintiff and defendant rows, and the city line from x ≥ 461 on the SEQ row;
  - checks SEQ with `^SEQ (\d+)$`;
  - returns `{ saleDate, records, blockErrors }`. `saleDate` is as printed (`11/17/2026`). `records` carry `sheriffId`, `plaintiff`, `upsetAmount`, `status`, `courtCase`, `defendant`, `attorney`, `attorneyPhone`, `address` (street + `\n` + city line), `parcel` and `seq`.

  A block that breaks a D5 rule becomes a block error with its page and first row. Items above a page's first prefix item become one block error too. A block error is never thrown, and never merged into another block.

- [ ] 3.3 Test `parseOceanListingPdf` with the fixture:
  - 86 records, sale date `11/17/2026`, every `seq` `001`, no block errors;
  - the `CH 778323`, `CH 780680` and `CH 780707` records from the spec scenarios (`CH 780707` has the adjourned date, and its phone is right of the upset column);
  - `CH 780789`'s `$0.00`;
  - the `DJ00099625` and `L144917` dockets;
  - the `OCEAN TOWNSHIP` city;
  - the page 7 street `1820 BAY TERRACE, BEACH HAVEN`, split into two items;
  - free-text lots and blocks (`LOT 26, 27, 28, 29`, `BLOCK 507 FKA 507`);
  - no status containing `NJ` or a ZIP, and no phone in a status (the 11 phones at x 473.56);
  - the 4 blocks without an attorney-file row (780606, 780646, 780706, 780794), and the 3 without a phone.

  Add synthetic item-input cases (no PDF needed):
  - a seven-digit sheriff number (that block fails, the previous one is intact);
  - a `SEQ 002` row;
  - a block cut off at the page end, and the items above the next page's first block;
  - pages disagreeing on the date;
  - a missing header;
  - a block with no `PLAINTIFF` row;
  - a plaintiff containing `PARAMOUNT`.

## 4. Snapshots and sync

- [ ] 4.1 Make `SnapshotListing.propertyId` and `BuildListingSnapshotArgs.propertyId` `number | null`. Make `ListingFieldWarning.propertyId` (`pipeline.ts:17`) `number | null`. Make the messages that print `propertyId` print the sheriff number when it's NULL: `syncListing`'s "has no sheriff number" error, and `pipeline.ts`'s sync, field-warning and failed-save log lines. Leave `replay/` and the CivilView scrape path on `number`, since they only see CivilView pages.
- [ ] 4.2 Add `ingest/oceanListingPage.ts`. It turns an Ocean record into the `ParsedListingPage` that `buildListingSnapshot` takes (D7):
  - `listing`: the listing fields plus `saleDate` as printed, without `status` or `seq`;
  - `statusHistory`: one row, with the title-cased status or `Scheduled`, and the same `M/D/YYYY` date.

  The Ocean pipeline calls `buildListingSnapshot` with county `Ocean` and `propertyId: null`. Test the four spec scenarios (scheduled, cancelled, adjourned, zero upset), including no field warnings for `CH 778323`.

- [ ] 4.3 Run `npx drizzle-kit generate --custom --name=drop_listing_property_id_not_null` in `packages/database`, using the next free migration number. Write `ALTER TABLE "Listing" ALTER COLUMN "propertyId" DROP NOT NULL;`, with a comment pointing at `0013`. On the local container, add the NOT NULL to match prod, apply the migration, check the column is nullable, and confirm `drizzle-kit generate` reports no schema changes.

## 5. Pipeline and handler

- [ ] 5.1 Move `pipeline.ts`'s sync-and-summarize tail (lines 113–162) into `syncCountySnapshots`, kept in `pipeline.ts` (D8), which takes county, found count, snapshots and field-warning count (D8). Call it from `newJerseySheriffSaleCountyParser`. `pipeline.test.ts`'s existing county cases must pass unchanged.
- [ ] 5.2 Add `oceanPdfParser()` to `pipeline.ts`. It:
  - fetches the Foreclosures page and archives it before looking for the link (D3);
  - finds and fetches the PDF, and awaits its archive before parsing;
  - parses the PDF, and rejects on a header error or zero blocks;
  - counts `found` as records plus block errors;
  - logs each block error with its page and first row;
  - builds snapshots (4.2) and calls `syncCountySnapshots` with county `Ocean`.
- [ ] 5.3 Add `CIVILVIEW_COUNTIES` (`NJ_COUNTIES` without Ocean) and `CivilViewCounty` to the sheriff-sale module. Retype these to `CivilViewCounty`:
  - `NJSheriffSaleCountyIdMap: Record<CivilViewCounty, string>`, removing Ocean's ID;
  - `getCountyListingsHtml`'s `county`;
  - `newJerseySheriffSaleCountyParser`'s `county`.

  Update `njSheriffSaleCountyIdMap.test.ts` to loop over `CIVILVIEW_COUNTIES`.

- [ ] 5.4 In `handler.ts`, build the list of runs (D9): one per CivilView county, plus Ocean. Run them in one `Promise.allSettled`, and name failures and counts from that list. Report a rejected Ocean run as county `Ocean` in the `N/17` error. Fix the comment that says Lambda's async retries engage: `maximum_retry_attempts` is 0.
- [ ] 5.5 Make replay default to `CIVILVIEW_COUNTIES` when no `--county` is given (`replay/args.ts:97`). `--county Ocean` stays accepted. Update `args.test.ts`.
- [ ] 5.6 Update `pipeline.test.ts` and `handler.test.ts`. Add `oceanPdfParser` to `handler.test.ts`'s `vi.mock('./pipeline')` factory, and replace its `toHaveBeenCalledTimes(NJ_COUNTIES.length)` with the CivilView count. Cover:
  - Ocean success;
  - Ocean with zero blocks and a valid header (rejects);
  - 30 of 86 parsing (30 synced, then rejects);
  - every Ocean write failing (rejects);
  - the archive rejecting (still parses and syncs);
  - the link not found (the page is still archived);
  - Ocean failing while CivilView succeeds (the handler names `Ocean`, `1/17`);
  - no CivilView request for Ocean.

## 6. Docs and specs

- [ ] 6.1 Update `backend/README.md`: the Ocean source, the `ocean-pdf-files/` prefix, and that replay doesn't cover it yet. Update `AGENTS.md`: the `platforms/` folders, and that PDF fixtures follow the same byte-for-byte rule.
- [ ] 6.2 If `add-njparcels-lookup` has landed first, reconcile this change's `civilview-scraping` delta with its county-list split, so that Ocean is absent from the sheriff-sale module's CivilView list.

## 7. Verify and ship

- [ ] 7.1 Run `npx vp check`, `npm run build` and `npm run test` at the root.
- [ ] 7.2 Add an `ocean` argument to `handler.local.ts` that runs `oceanPdfParser()` alone. Today it only runs Atlantic. Ask before running it, because it sends real requests to the county sites and writes to the prod bucket (AGENTS.md). Run it once with `DATABASE_URL` pointing at the local container, and check:
  - the local DB has about 86 Ocean rows with `propertyId` NULL;
  - S3 has today's `ocean-pdf-files/` objects, with the PDF's size matching the download;
  - the county hosts accepted the requests (D2's empty `Authorization` header).
- [ ] 7.3 Merge. After CI applies the migration, check the next 00:00 UTC run's logs: `Synced Ocean County: found N, parsed N, … failed writes 0`, no `countyId=85` request, and `17/17 counties succeeded`.
- [ ] 7.4 Follow the PDF's archive for two weeks to answer the design's open questions (update cadence, multiple sale dates, page splits, the `S` column), and record the answers in `design.md`.
