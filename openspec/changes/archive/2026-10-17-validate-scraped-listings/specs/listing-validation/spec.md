## ADDED Requirements

### Requirement: Scraped listings are validated before storage

Every listing the scraper parses SHALL pass through a Zod 4 schema before it's enriched and saved. The schema's output type SHALL be the TypeScript type the rest of the pipeline uses, so no `as` cast stands between the parsed HTML and the database insert.

#### Scenario: Validated listing is saved

- **WHEN** a listing page's detail table has a valid `Address` and `Upset Amount` of `$1,585.95`
- **THEN** the listing passed to `saveListing` has `upsetAmount` equal to the number `1585.95`

#### Scenario: No unchecked casts

- **WHEN** `backend/src/services/newJerseySheriffSale/` and `backend/src/controllers/` are searched for `as ListingParse` and `as string` on parsed fields
- **THEN** no matches are found

### Requirement: Only a missing address rejects a listing

A listing whose `address` is missing, or is empty after trimming, SHALL be rejected: `scrapeListing` throws, and the listing counts in `failedListings`. When any other field fails validation or coercion, the listing SHALL still be saved, with that field set per the coercion rules, and a field warning SHALL be recorded.

#### Scenario: Missing address

- **WHEN** a listing's detail table has no `Address` row, or the address cell is whitespace-only
- **THEN** the listing is not saved and the county summary's `failedListings` includes it

#### Scenario: Bad money value does not reject the listing

- **WHEN** a listing has a valid address and `Upset Amount` of `TBD`
- **THEN** the listing is saved with `upsetAmount` NULL and one field warning naming `upsetAmount`, the value `TBD` and the `propertyId`

### Requirement: Money coercion

`upsetAmount` and `judgment` SHALL be coerced from the site's `$D,DDD.DD` text to a number, after stripping `$`, commas and whitespace (including `\r`). `$0.00` SHALL become `0`. A value that is empty or whitespace-only SHALL become NULL without a warning. Any other value that isn't a non-negative decimal with at most two fraction digits SHALL become NULL with a warning.

#### Scenario: Dirty money string

- **WHEN** `judgment` is `"\r $1,002,812.05                    "`
- **THEN** it is stored as `1002812.05`

#### Scenario: Zero amount

- **WHEN** `upsetAmount` is `$0.00`
- **THEN** it is stored as `0`, not NULL

#### Scenario: Whitespace-only amount

- **WHEN** `upsetAmount` is `"\r                     "`
- **THEN** it is stored as NULL and no warning is recorded

### Requirement: Date coercion

`saleDate` and each status-history `date` SHALL be coerced from `M/D/YYYY` or `MM/DD/YYYY`, optionally followed by a time such as ` 02:00 PM`, to a calendar date. The time SHALL be dropped. A date whose year falls outside 2000 to (the current year + 5), or that isn't a real calendar date, SHALL be treated as invalid. An invalid or empty `saleDate` SHALL become NULL, with a warning when it was non-empty.

#### Scenario: Date with time

- **WHEN** `saleDate` is `08/12/2024 02:00 PM`
- **THEN** it is stored as the date `2024-08-12`

#### Scenario: Out-of-range year

- **WHEN** `saleDate` is `4/30/3021`
- **THEN** it is stored as NULL and a warning is recorded

#### Scenario: Impossible date

- **WHEN** `saleDate` is `2/30/2024`
- **THEN** it is stored as NULL and a warning is recorded

### Requirement: Status-history rows are validated

Each status-history row SHALL have a non-empty trimmed `status` and a valid `date`, per the date coercion rules. A row that fails SHALL be skipped with a warning, and the listing's other rows SHALL still be saved.

#### Scenario: One bad row

- **WHEN** a listing has three status-history rows and one is dated `4/30/3021`
- **THEN** the listing is saved with two status-history rows, and one warning is recorded

### Requirement: Text normalization

Every scraped text field SHALL have `\r` removed and leading and trailing whitespace trimmed, and SHALL be stored as NULL when the result is empty. `address` SHALL additionally have every run of inner whitespace collapsed to a single space. Other fields SHALL keep their inner newlines.

#### Scenario: Plaintiff with carriage return

- **WHEN** `plaintiff` is `"\r U.S. BANK NATIONAL ASSOCIATION                    "`
- **THEN** it is stored as `U.S. BANK NATIONAL ASSOCIATION`

#### Scenario: Multi-line address

- **WHEN** the address cell is `40-42 MYRTLE STREET\nBRIDGETON NJ 08302`
- **THEN** `address` is `40-42 MYRTLE STREET BRIDGETON NJ 08302`

### Requirement: Attorney phone normalization

`attorneyPhone` SHALL be normalized to `(AAA) BBB-CCCC` when the trimmed value is a single 10-digit US number, with an optional leading `1`, optional parentheses, spaces, dots or dashes as separators, and an optional trailing `(NJ)`. When that number is followed only by an extension (`EXT`, `EXT.`, `X`, case-insensitive), the result SHALL be `(AAA) BBB-CCCC xNNNN`. Any other non-empty value SHALL be kept as its trimmed text, with a warning.

#### Scenario: Common shapes

- **WHEN** `attorneyPhone` is any of `973-575-0707`, `(973)575-0707`, `973 575-0707`, `(973)-575-0707`, `1(973) 575-0707`, `973-575-0707 (NJ)`
- **THEN** it is stored as `(973) 575-0707`

#### Scenario: Extension

- **WHEN** `attorneyPhone` is `856-813-1700 X 2021`
- **THEN** it is stored as `(856) 813-1700 x2021`

#### Scenario: Unparseable phone

- **WHEN** `attorneyPhone` is `973-575-0707 EXT 1234 / FAX 973-575-0708 NICHOLAS`
- **THEN** it is stored as that trimmed text, and a warning is recorded

### Requirement: Unknown fields are dropped

A detail-table key that doesn't map to a known listing field SHALL NOT be passed to the database insert, and SHALL produce a warning naming the key.

#### Scenario: New row on the site

- **WHEN** the detail table has a `Township` row that the scraper doesn't know
- **THEN** the saved listing has no `township` property, and a warning names `township`

### Requirement: Field warnings are counted per county

Each field warning SHALL be logged with the county, `propertyId`, field name and raw value. The county summary SHALL include a `fieldWarnings` count, alongside `found`, `parsed`, `failedListings`, `inserted` and `failedWrites`.

#### Scenario: Summary reports warnings

- **WHEN** a county run parses 10 listings and 3 of them have one coerced-to-NULL field each
- **THEN** the county summary has `fieldWarnings: 3`, and the run does not fail because of them
