## ADDED Requirements

### Requirement: Candidate parcels and re-check schedule

Each run SHALL look up the distinct `pamsPin` values of listings whose `saleDate` is today or later. A PIN SHALL be due when it has no `NjParcel` row, or when its row is:

- `found` and checked 180 or more days ago;
- `not_found` and checked 30 or more days ago;
- `error`.

Due PINs that were never checked SHALL go first, then the rest by oldest `checkedAt`. A PIN shared by several listings SHALL be fetched once.

#### Scenario: New upcoming listing

- **WHEN** an upcoming listing has `pamsPin` `0714_2001_1` and no `NjParcel` row exists for it
- **THEN** the next run fetches it

#### Scenario: Recently found

- **WHEN** `0714_2001_1` was found 20 days ago
- **THEN** the run doesn't fetch it

#### Scenario: Past sale

- **WHEN** a listing's `saleDate` is yesterday and its PIN was never checked
- **THEN** the run doesn't fetch it

#### Scenario: Nothing due

- **WHEN** no PIN is due
- **THEN** the run makes no requests to njparcels and succeeds

### Requirement: Polite request pacing

The njparcels client SHALL have at most one request in flight. It SHALL wait at least 5,000 ms between the end of one response and the start of the next request. It SHALL NOT follow redirects. On a `429` or `5xx` response, it SHALL double the wait for the rest of the run. After three consecutive failed requests, the run SHALL stop making requests and log why.

#### Scenario: Spacing

- **WHEN** a run fetches three parcels
- **THEN** each request starts at least 5 seconds after the previous response ended

#### Scenario: Throttled

- **WHEN** njparcels answers `429`
- **THEN** that parcel is recorded as `error`, and later requests in the run are spaced at least 10 seconds apart

#### Scenario: Site down

- **WHEN** three requests in a row fail
- **THEN** the run makes no further requests

### Requirement: Time budget

The pipeline SHALL NOT start a lookup when the Lambda has less than 30 seconds of its timeout left. PINs not reached SHALL stay due for the next run, and the summary SHALL count them as skipped.

#### Scenario: Backlog larger than one run

- **WHEN** 1,100 PINs are due
- **THEN** the run looks up as many as fit, ends before its timeout, and counts the rest as skipped

### Requirement: Property page fetch and outcome

A lookup SHALL fetch `https://njparcels.com/property/<code>/<block>/<lot>`, with the qualifier path segment the condo spike settles on, and SHALL classify the response:

- **`found`:** a `200` whose page names the same block and lot as the request.
- **`not_found`:** a `303` to `/search/`.
- **`error`:** any other status or redirect, a network failure, or a page whose identity sentence is missing or names a different block or lot. The reason SHALL be kept.

#### Scenario: Existing parcel

- **WHEN** `0714_2001_1` is looked up
- **THEN** the page is fetched from `/property/0714/2001/1`, and the outcome is `found`

#### Scenario: Unknown parcel

- **WHEN** njparcels answers `303` with location `/search/`
- **THEN** the outcome is `not_found`

#### Scenario: Page for another parcel

- **WHEN** the fetched page says "is Block 2002, Lot 1" for a request for block 2001
- **THEN** the outcome is `error` with a reason naming the mismatch

### Requirement: Property page parsing

From a `found` page the parser SHALL read:

- the property location;
- Type, Building Description and Acreage from the property table;
- the zone from "within the **`<zone>`** zone", or null when the page doesn't state one;
- the last sale price and date;
- the deed book and page;
- the assessed total, land and improvement values;
- the annual taxes.

Money values SHALL be read from the page's `<noscript>` fallbacks. A value the page doesn't have SHALL be null.

#### Scenario: Page with a zone

- **WHEN** the fixture for Washington Twp `0336/10.01/1` is parsed
- **THEN** `zone` is `PP`

#### Scenario: Page without a zone

- **WHEN** the fixture for Newark `0714/2001/1` is parsed
- **THEN** `zone` is null, `assessedTotal` is 535000, `assessedLand` 220000, `assessedImprovement` 315000, `lastSalePrice` 956000, `lastSaleDate` 2019-09-10, `deedBook` `20190`, `deedPage` `94535`, `annualTaxes` 19987.60, `propertyType` `commercial` and `acreage` 0.0652

### Requirement: Parcel storage

An `NjParcel` table SHALL hold one row per `pamsPin`, enforced unique. Each row SHALL have:

- the code, block, lot and qualifier;
- a `status` of `found`, `not_found` or `error`;
- `lastError`, `checkedAt` and `firstFoundAt`;
- the parsed fields, with money and acreage as exact decimals and the sale date as a date.

Every lookup SHALL set `status` and `checkedAt`. A `found` lookup SHALL overwrite the parsed fields and clear `lastError`. A `not_found` or `error` lookup SHALL leave the parsed fields as they were. `firstFoundAt` SHALL be set on the first `found` and never changed after.

#### Scenario: Error after a good lookup

- **WHEN** a row is `found` with `assessedTotal` 535000, and a later lookup errors
- **THEN** the row's `status` is `error`, `lastError` holds the reason, and `assessedTotal` is still 535000

#### Scenario: Re-check finds a new assessment

- **WHEN** a `found` row is re-checked 180 days later and the page shows a new assessed total
- **THEN** the row holds the new value, its `checkedAt` is updated, and `firstFoundAt` is unchanged

### Requirement: Best-effort raw page archive

Each fetched property page SHALL be saved to the archive bucket under `njparcels/<code>/<YYYY-MM-DD>/<pamsPin>.html`. A failed archive write SHALL be logged and SHALL NOT change the lookup's outcome.

#### Scenario: Archive write fails

- **WHEN** the S3 write for a fetched page fails
- **THEN** the lookup is still stored with its parsed outcome, and the failure is logged

### Requirement: Run summary and failure rule

The handler SHALL log and return the run's counts: looked up, `found`, `not_found`, `error`, skipped, and `found` pages with a zone. The run SHALL fail (throw) only when it attempted at least one lookup and none came back `found` or `not_found`.

#### Scenario: One bad parcel

- **WHEN** a run looks up 150 parcels and 1 errors
- **THEN** the run succeeds, and its summary counts 1 error

#### Scenario: Parser broken by a redesign

- **WHEN** every page in a run fails the identity check
- **THEN** the run throws, and the invocation goes to the dead-letter queue
