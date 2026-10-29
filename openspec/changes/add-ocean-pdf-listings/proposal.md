## Why

Ocean County stopped publishing its sheriff sales on salesweb.civilview.com. Its CivilView page (`countyId=85`) says "No search results found" and "last updated: 2/27/2026". Every archived copy since 2026-10-18 is the same 11,256-byte empty page, and prod has never stored an Ocean listing. The daily scrape reports `Synced Ocean County: found 0` and treats that as success, so the gap has been invisible.

The sheriff still publishes the sales, as a PDF. The [Foreclosures page](https://sheriff.co.ocean.nj.us/frmForeclosures) links a "Foreclosure Listing" PDF on co.ocean.nj.us. On 2026-10-25 it was a current 15-page fixed-width report: 86 listings for the 11/17/2026 sale. Each listing gives a sheriff number (`CH 778323`), a docket (`F01582818`), the plaintiff, the defendant, the attorney and phone, the upset amount, the address with city and ZIP, lot and block, and a status (`CANCELLATION`, `PURCHASED`, `ADJOURNED UNTIL`, or blank). That's most of what a CivilView listing carries, for a county that runs a sale most Tuesdays.

## What Changes

- Add an **Ocean PDF source** to the `sheriffSale` module. Each daily run:
  - reads the Foreclosures page and finds the current "Foreclosure Listing" link (its file name is a GUID, so it isn't hard-coded);
  - downloads the PDF, and archives it and the Foreclosures page to S3 before parsing;
  - parses the PDF's positioned text into listing records;
  - builds snapshots and syncs them through the existing `syncListing`.
- Parse the PDF by text position, not by line. A text dump wraps and misaligns the columns: upset amounts land on their own lines, and the status column drifts. Positioned text items are grouped into listing blocks at the sheriff-number prefix column, assigned to rows by their offset below the sheriff-number row, and read as spans between each row's label and its next marker (an amount, a phone, the city column). The attorney phone has no fixed column, so global x columns can't place it.
- Map the PDF's fields onto the existing listing fields:
  - sheriff number → `sheriffId`, normalized by the existing rule;
  - docket → `courtCase`, as printed (usually `F01582818`, but also `L144917` or `DJ00099625`);
  - lot and block → `parcel`, as `LOT <lot> BLOCK <block>`;
  - the report's sale date → `saleDate`;
  - the address, plaintiff, defendant, attorney, phone and upset amount → their columns, through `listingSchema`'s coercions.
- Build status history from the PDF. Each snapshot gives one row dated the sale date: the PDF's status text when the status column has a value (`Adjourned Until 12/15/2026` keeps its new date), and `Scheduled` when it's blank. A listing adjourned to a later sale shows up under the new date in a later PDF, which adds a new row.
- **Allow a listing without a property ID.** Ocean has no CivilView `propertyId`. Prod still has a Prisma-era NOT NULL on `Listing.propertyId`, which the Drizzle schema doesn't declare, so a custom migration drops it. `SnapshotListing.propertyId` becomes `number | null`.
- **Stop scraping Ocean on CivilView.** The handler runs CivilView for every county except Ocean, and runs the Ocean PDF source alongside them. Ocean shares the counties' sync and failure rules, including "every write failed", through one helper pulled out of `pipeline.ts`. An Ocean failure fails the run the same way a county failure does, so the existing errors and dead-letter-queue alarms cover it. Replay defaults to the CivilView counties.
- Let `saveS3` take binary data, so the PDF is archived byte for byte.

**Out of scope:**

- Replaying archived Ocean PDFs. The archive layout is chosen so a later change can add it.
- Expanding plaintiff and city names the PDF cuts off at the column edge (`U.S. BANK NATIONAL ASSOCIATION, SUC`, `LITTLE EGG HARB`).
- The PDF's unlabeled `S` column.
- Ocean clerk records, which sit behind reCAPTCHA (see `add-clerk-records-press`).
- Showing Ocean on the frontend. Its county list (`citiesByCountyMapping.ts`) has no Ocean entry, and its listing queries use router names that no longer exist.

## Capabilities

### New Capabilities

- `ocean-pdf-scraping`: finding the current Foreclosure Listing PDF, archiving it, parsing its positioned text into listing records, mapping fields and statuses, per-listing failure isolation, and Ocean's failure rule.

### Modified Capabilities

- `civilview-scraping`: "Correct and complete county IDs" no longer scrapes Ocean on CivilView.
- `scraper-pipeline`: "Run fails when any county fails" covers the Ocean PDF source as one more county.
- `listing-sync`: a snapshot may have no `propertyId`. Identity is still county and sheriff number.
- `listing-storage`: `propertyId` is nullable, and the stale "One listing per property ID" requirement is removed.

## Impact

- **Code:** new `scrape/platforms/oceanPdf/` and `parse/platforms/oceanPdf/` in `backend/src/modules/sheriffSale/`, following `clerkRecords`'s `platforms/press` layout, plus an Ocean entry in `pipeline.ts`, `handler.ts` and `handler.local.ts`. `pipeline.ts`'s sync-and-summarize tail becomes a shared helper. The CivilView county map, `getCountyListingsHtml` and the county parser are typed on CivilView counties, and replay defaults to them. `shared/s3/saveS3.ts` accepts binary data and a content type. `SnapshotListing.propertyId` is nullable.
- **Database:** one custom, expand-only migration that drops the NOT NULL on `Listing.propertyId`. Nothing reads `propertyId` as an identity any more: no index uses it, `contentHash` leaves it out, and the frontend doesn't read it.
- **Dependencies:** a PDF text extractor for the Lambda bundle, `unpdf` (a serverless build of pdf.js). A minimal unpdf bundle measured 2.3 MB unminified, which takes `dist/index.js` from 3.7 MB to about 6 MB.
- **External systems:** two more requests a day, to sheriff.co.ocean.nj.us and co.ocean.nj.us.
- **S3:** a new archive prefix, `ocean-pdf-files/<YYYY-MM-DD>/`, in `nj-sheriff-sale`. The scraper role already has `s3:PutObject` on the bucket.
- **Data:** about 86 Ocean listings appear in prod on the first run. The frontend won't show them until it gets an Ocean entry (out of scope).
- **Ordering:** the in-progress `add-njparcels-lookup` change also rewrites "Correct and complete county IDs", to give the sheriff-sale module its own county list. Whichever change lands second must drop Ocean from that list.
