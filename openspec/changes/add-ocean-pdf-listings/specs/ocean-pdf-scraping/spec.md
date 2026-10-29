## ADDED Requirements

### Requirement: Find the current Foreclosure Listing PDF

Each run SHALL fetch `https://sheriff.co.ocean.nj.us/frmForeclosures` and take the PDF URL from the anchors whose text, with its whitespace collapsed, is `Foreclosure Listing` (case-insensitive) and whose `href` ends in `.pdf`. Each URL SHALL be resolved against the page URL, have repeated slashes in its path collapsed, and use `https:`. Anchors that resolve to the same URL SHALL count as one link. No PDF URL SHALL be hard-coded.

#### Scenario: Link on the page

- **WHEN** the page links `Foreclosure Listing` to `http://www.co.ocean.nj.us//WebContentFiles//3ec14ac4-25a1-41cd-8c8b-d9996a9d686c.pdf`
- **THEN** the PDF is fetched from `https://www.co.ocean.nj.us/WebContentFiles/3ec14ac4-25a1-41cd-8c8b-d9996a9d686c.pdf`

#### Scenario: Same link listed twice

- **WHEN** the page has two `Foreclosure Listing` anchors, in its desktop and mobile lists, that resolve to the same PDF URL
- **THEN** that PDF is fetched

#### Scenario: Link missing or ambiguous

- **WHEN** the page has no matching anchor, or matching anchors that resolve to two different PDF URLs
- **THEN** the Ocean run rejects with an error that names the Foreclosures page and lists the URLs that matched

### Requirement: Archive the Foreclosures page and the PDF

Each run SHALL save the Foreclosures page to `ocean-pdf-files/<YYYY-MM-DD>/foreclosures.html`, and the PDF to `ocean-pdf-files/<YYYY-MM-DD>/foreclosure-listing.pdf` with content type `application/pdf`, in `nj-sheriff-sale`, where the date is the run's archive date. The Foreclosures page SHALL be saved as soon as it's fetched, before the PDF link is looked for. The PDF SHALL be saved byte for byte, and its save SHALL finish before parsing starts. A failed save SHALL be logged, and SHALL NOT stop the run.

#### Scenario: PDF archived unchanged

- **WHEN** the run downloads a 41,939-byte PDF and parses it
- **THEN** `ocean-pdf-files/<today>/foreclosure-listing.pdf` holds the same 41,939 bytes, and the downloaded bytes are unchanged after parsing

#### Scenario: Link not found

- **WHEN** the Foreclosures page has no `Foreclosure Listing` link
- **THEN** the page is still archived to `ocean-pdf-files/<today>/foreclosures.html`, and the Ocean run rejects

#### Scenario: Archive fails

- **WHEN** saving the PDF to S3 rejects
- **THEN** the error is logged, and the PDF is still parsed and synced

### Requirement: Parse the PDF by text position

The parser SHALL read each page's text items with their coordinates, SHALL drop items whose text is blank, and SHALL identify the page header by position, not by its text. It SHALL read the sale date from the header's `REAL ESTATE LISTING FOR <M/D/YYYY>`, matched on the header line's items joined in x order, and SHALL return it as printed. It SHALL fail the layout when any page lacks that header or two pages disagree on the date.

A listing block SHALL start at an item in the sheriff-number prefix column, left of the docket column. It SHALL end before the next such item or at the end of its page.

Rows within a block SHALL be assigned by their offset below the sheriff-number row, to bands separated by gaps. Within a row, items SHALL be read in x order, and each field SHALL be every item in its span, joined with a space. The status SHALL be the status-column items on the plaintiff and defendant rows only, joined with a space. The docket SHALL be taken as printed, with no pattern check.

The attorney-file row and the attorney phone SHALL be optional.

#### Scenario: Fixture listing

- **WHEN** the 2026-10-25 fixture PDF is parsed
- **THEN** it yields 86 listing records with sale date `11/17/2026`, each with SEQ `001`, and the record for `CH 778323` has:
  - plaintiff `U.S. BANK NATIONAL ASSOCIATION, SUC`
  - upset amount `$604,809.38`
  - court case `F01582818`
  - defendant `GEORGE DUTCHER, ETC., ET AL`
  - attorney `STERN & EISENBERG, PC` and phone `609-397-9200`
  - address `3139 CREEK ROAD` / `TOMS RIVER NJ 08753`
  - parcel `LOT 24 BLOCK 1108.31`
  - no status

#### Scenario: Status column

- **WHEN** the fixture's `CH 780680` record is parsed
- **THEN** its status is `CANCELLATION` and its upset amount is `$124,804.53`

#### Scenario: Adjourned with a new date

- **WHEN** the fixture's `CH 780707` record is parsed
- **THEN** its status is `ADJOURNED UNTIL 12/15/2026`, its upset amount is `$471,002.41`, and its defendant is `ANN A. SHUFORD, ET AL`

#### Scenario: Phone far from its column

- **WHEN** the fixture's `CH 780707` record is parsed, whose attorney is `ROBERTSON ANSCHUTZ SCHNEID CRANE & PARTNERS PLLC.`
- **THEN** its attorney phone is `973-575-0707`, though it sits right of the status column's x, and it isn't part of the status, upset amount or city

#### Scenario: City line isn't a status

- **WHEN** any fixture record is parsed
- **THEN** its city line's `NJ` and ZIP, though right of the status column's x, aren't part of its status

#### Scenario: Street split into items

- **WHEN** the fixture's page 7 street is drawn as `1820 BAY TERRACE, BEACH` and `HAVEN`
- **THEN** the record's street is `1820 BAY TERRACE, BEACH HAVEN`

#### Scenario: Docket that isn't F plus eight digits

- **WHEN** a fixture record's docket is `DJ00099625` or `L144917`
- **THEN** its court case is stored as printed

#### Scenario: Header words in listing text

- **WHEN** a listing's city is `OCEAN TOWNSHIP`, or its plaintiff contains `PARAMOUNT`
- **THEN** the row is parsed as listing data, not skipped as a header

#### Scenario: Pages disagree on the sale date

- **WHEN** page 1 says `REAL ESTATE LISTING FOR 11/17/2026` and page 2 says `11/24/2026`
- **THEN** parsing rejects with an error naming both dates

### Requirement: Ocean records become listing snapshots

Each parsed record SHALL be built into a `ListingSnapshot` by `buildListingSnapshot`, so it goes through `validateListingDetails` with the same coercions and field warnings as a CivilView details record. The snapshot SHALL have:

- county `Ocean`;
- `propertyId` NULL;
- `sheriffId` normalized by `normalizeSheriffId`;
- `parcel` as `LOT <lot> BLOCK <block>`;
- the address split by `parseAddress`;
- `saleDate` from the PDF header;
- the run's archive date as its snapshot date.

Only listing fields SHALL be passed as the listing, so the status and SEQ raise no "not a listing field" warning. The status history SHALL have exactly one row, dated the sale date. The sale date SHALL be passed to both in the `M/D/YYYY` form the PDF prints, which the validators convert. The row's status SHALL be the record's status text, title-cased, or `Scheduled` when the record has none.

#### Scenario: Scheduled listing

- **WHEN** `CH 778323` from the fixture is built on 2026-10-25
- **THEN** the snapshot has county `Ocean`, `sheriffId` `CH778323`, `propertyId` NULL, `saleDate` 2026-11-17, `courtCase` `F01582818`, street `3139 Creek Road`, city `Toms River`, zipcode `08753`, one status row `Scheduled` dated 2026-11-17, and no field warnings

#### Scenario: Cancelled listing

- **WHEN** `CH 780680` from the fixture is built
- **THEN** its one status row is `Cancellation` dated 2026-11-17

#### Scenario: Adjourned listing

- **WHEN** `CH 780707` from the fixture is built
- **THEN** its one status row is `Adjourned Until 12/15/2026` dated 2026-11-17

#### Scenario: Zero upset

- **WHEN** `CH 780789`'s upset amount is `$0.00`
- **THEN** the snapshot's `upsetAmount` is 0, with no field warning

### Requirement: Ocean per-listing failure isolation

A listing block SHALL fail when:

- its first items aren't a 1–3 letter prefix and a six-digit number;
- it lacks a `PLAINTIFF`, `DEFENDANT`, `ATTORNEY`, `SEQ` or `Lot:`/`Block:` row, or its `Lot:`/`Block:` row isn't a `Lot:` item followed by a `Block:` item;
- it has an item outside every row band;
- it has more than one `SEQ` row, or a SEQ other than `001`;
- it reaches the end of its page before its `Lot:`/`Block:` row.

Items on a page above its first block's prefix item SHALL form one failed block, counted among the blocks found.

A failed block SHALL be logged with its page number and first row, and skipped. It SHALL NOT be merged into a neighbouring block, and SHALL NOT stop the other blocks from being parsed or synced.

#### Scenario: One malformed block

- **WHEN** one of 86 blocks has no `PLAINTIFF` row
- **THEN** the other 85 are synced, and the failure is logged with the block's page and first row

#### Scenario: Unrecognised sheriff number

- **WHEN** a block's sheriff-number column holds `CH 7803231`
- **THEN** that block fails, and the previous block's record is unchanged

#### Scenario: Second parcel

- **WHEN** a block has a `SEQ 002` row
- **THEN** that block fails

#### Scenario: Block cut off by a page break

- **WHEN** a page ends after a block's `SEQ` row and before its `Lot:`/`Block:` row
- **THEN** that block fails, the next page's items above its first prefix item are one more failed block, and the next page's first block is parsed on its own

### Requirement: Ocean failure rule

The Ocean run SHALL reject when:

- the Foreclosures page or the PDF can't be fetched;
- the PDF link isn't found, or the matching links point at different PDFs;
- the PDF's header is missing, or its pages disagree on the sale date;
- the PDF has no listing blocks;
- no listing block parses;
- every listing write fails;
- fewer than half of the listing blocks parse.

In the last case, the records that did parse SHALL be synced before the run rejects. Ocean SHALL apply the same sync, write-failure and summary rules as a CivilView county, through the same code. A successful run SHALL log `Synced Ocean County:` with the same counts as a CivilView county summary.

#### Scenario: Valid header but no blocks

- **WHEN** the PDF has a valid `REAL ESTATE LISTING FOR` header and no listing blocks
- **THEN** the Ocean run rejects with an error that says no listings were found in the PDF

#### Scenario: Under half parse

- **WHEN** 30 of 86 blocks parse
- **THEN** the 30 are synced, and the Ocean run rejects with an error naming both counts

#### Scenario: Every write fails

- **WHEN** all 86 blocks parse, and every listing write rejects
- **THEN** the Ocean run rejects with an error that all 86 writes failed

#### Scenario: Successful run summary

- **WHEN** all 86 fixture blocks parse and sync
- **THEN** the run logs `Synced Ocean County: found 86, parsed 86, failed 0, …`
