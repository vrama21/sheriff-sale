## ADDED Requirements

### Requirement: Candidate listing selection

Each run SHALL select candidate listings from the supported counties whose lookup is due. A listing is due when it has no lookup state, or when its `nextCheckAt` is at or before the run's start time. A listing SHALL NOT be selected when its sale date is more than 90 days in the past. Each run SHALL take at most `MAX_LISTINGS_PER_COUNTY_PER_RUN` (40) listings per county, in ascending order of sale date.

#### Scenario: New listing

- **WHEN** a Passaic listing created today has no lookup state
- **THEN** it is a candidate in the next run

#### Scenario: Backlog larger than the cap

- **WHEN** 119 Passaic listings are due
- **THEN** the run looks up the 40 with the nearest sale dates and leaves the rest due

#### Scenario: Long-past sale

- **WHEN** a listing's sale date was 120 days ago
- **THEN** it is not selected, whatever its lookup state

### Requirement: Re-check schedule

After each lookup, the listing's `nextCheckAt` SHALL be set from the outcome:

- lis pendens matched and sale upcoming: 14 days later, capped at the sale date
- no lis pendens found: 7 days later, or 30 days later after 6 consecutive misses
- sale date passed without a sheriff's deed: the next of sale + 30, + 60 and + 90 days, then no further checks
- sheriff's deed matched: no further checks
- error: 1 day later, or 7 days later after 5 consecutive errors

#### Scenario: Matched before the sale

- **WHEN** a lookup on 1 October matches a lis pendens for a listing selling on 8 October
- **THEN** `nextCheckAt` is 8 October

#### Scenario: Sheriff's deed found

- **WHEN** a post-sale lookup matches a `SHERIFF_DEED`
- **THEN** the listing gets no `nextCheckAt` and is not selected again

#### Scenario: Repeated misses

- **WHEN** a listing's lookup finds no lis pendens for the sixth time in a row
- **THEN** `nextCheckAt` is 30 days later

### Requirement: Block/lot extraction from listing text

The module SHALL extract `{ block, lot, extraLots, qualifier }` from a listing's `parcel` and `description` text. It SHALL recognise at least these forms: `TAX LOT x BLOCK y`, `LOT x IN BLOCK y`, `Lot and Block: Lot x, Block y`, `BLOCK y LOT x`, and `Blk`/`Lt` abbreviations. It SHALL also recognise additional-lot lists and condo qualifiers such as `C0201`. Text that matches no pattern SHALL yield null. When comparing values, leading zeros in integer parts SHALL be ignored and decimal blocks SHALL be kept as they are.

#### Scenario: Passaic parcel

- **WHEN** `parcel` is `TAX LOT 39 BLOCK 20.13`
- **THEN** extraction returns block `20.13`, lot `39`

#### Scenario: Union parcel with additional lots

- **WHEN** `parcel` is `LOT 6, ADDITIONAL LOTS 12, 18-B BLOCK 21`
- **THEN** extraction returns block `21`, lot `6`, extra lots `12` and `18-B`

#### Scenario: Hudson condo unit

- **WHEN** `description` starts `LOT 43 IN BLOCK 504 C0201 AND LOT 43 IN BLOCK 504 C0202`
- **THEN** extraction returns block `504`, lot `43`, qualifier `C0201`

#### Scenario: Disclaimer text in parcel

- **WHEN** `parcel` is `the surplus, if any. This does not const…` and `description` has no block/lot
- **THEN** extraction returns null

### Requirement: Party-name normalization

The module SHALL normalize party names by uppercasing, removing punctuation and collapsing whitespace. It SHALL remove entity suffixes (LLC, INC, CORP, CO, NA, FSB) and role phrases (`AS TRUSTEE FOR …`, `ET AL`, `ET UX`, `H/W`, `HIS WIFE`, `AKA …`, `INDIVIDUALLY`). A MERS nominee phrase SHALL be replaced by the nominee's name. Two person names SHALL match when their normalized token sets are equal, regardless of order. Two entity names SHALL match when their token-set Jaccard similarity is at least the configured threshold. A listing's `defendant` SHALL be split into individual defendants on `;` and ` AND `, and on `, ` only after role phrases have been removed.

#### Scenario: Order-insensitive person match

- **WHEN** the listing's defendant is `John A. Smith` and a clerk party is `SMITH JOHN A`
- **THEN** the names match

#### Scenario: Trustee boilerplate

- **WHEN** the listing's plaintiff is `U.S. Bank National Association, as Trustee for XYZ Trust 2006-1` and a clerk party is `U S BANK NATIONAL ASSOCIATION`
- **THEN** the names match

#### Scenario: Different people with the same surname

- **WHEN** the listing's defendant is `John Smith` and a clerk party is `SMITH JANE`
- **THEN** the names do not match

### Requirement: Lis pendens match

For each candidate, the module SHALL name-search the primary defendant for `LIS_PENDENS` documents. The date range SHALL run from 1 January of the docket year (taken from the last two digits of `courtCase`) to the sale date. When the docket year can't be parsed, the range SHALL be the 3 years before the sale date. A candidate document SHALL be accepted only when one of its direct parties matches a listing defendant and at least one of these also holds: an indirect party matches the plaintiff, or its town and block/lot agree with the listing's. An accepted lis pendens SHALL get confidence `high` when the defendant, the plaintiff and the town all agree, and `medium` otherwise. It SHALL be stored with role `FORECLOSED_LIS_PENDENS` and `matchedBy` `lis_pendens_party`.

#### Scenario: Strong match

- **WHEN** a lis pendens has the listing's defendant as a direct party, the listing's plaintiff as an indirect party, and the listing's town
- **THEN** it is stored as `FORECLOSED_LIS_PENDENS` with confidence `high`

#### Scenario: Plaintiff substituted

- **WHEN** a lis pendens has the listing's defendant and the same town and block/lot, but a different plaintiff
- **THEN** it is stored with confidence `medium`

#### Scenario: Defendant only

- **WHEN** a lis pendens has the listing's defendant, but neither the plaintiff nor the town and block/lot agree
- **THEN** it is not stored

#### Scenario: Essex docket year

- **WHEN** `courtCase` is `F00258326`
- **THEN** the search starts on 1 January 2026

### Requirement: Parcel sweep

When a block and lot are known, either from the matched lis pendens or from the listing's text, the module SHALL run one block/lot search for the parcel with no date limit. Each returned document whose parties include a listing defendant SHALL be matched with `matchedBy` `parcel` and confidence `high`. The parcel's other documents SHALL be matched with confidence `medium`. Roles SHALL be `PRIOR_DEED` for deeds into a defendant, `SHERIFF_DEED` for sheriff's deeds recorded after the sale date, `MORTGAGE_ASSIGNMENT` for assignments, and `RELATED` otherwise. When the county's block/lot index has a start date, the sweep result SHALL NOT be treated as complete for documents before it.

#### Scenario: Deed chain from the lis pendens's parcel

- **WHEN** the matched lis pendens lists block `522`, lot `10` in Margate, and a block/lot search returns a deed into the defendant and two assignments
- **THEN** the deed is stored as `PRIOR_DEED`/`high` and the assignments as `MORTGAGE_ASSIGNMENT`

#### Scenario: Sheriff's deed after the sale

- **WHEN** a post-sale re-check's parcel sweep returns a sheriff's deed recorded after the sale date
- **THEN** it is stored as `SHERIFF_DEED` and the listing's lookups stop

### Requirement: Foreclosed mortgage match

The module SHALL identify the mortgage foreclosed by the matched lis pendens, using the first method that succeeds:

1. Follow a recorded cross-reference from the lis pendens to a mortgage, when the platform exposes one (`cross_reference`, `high`).
2. Take the latest mortgage from the parcel sweep that was recorded before the lis pendens and whose direct party matches a defendant (`parcel`, `high`).
3. Name-search the defendant for `MORTGAGE` before the lis pendens date, and pick the candidate whose mortgagee matches the plaintiff or an assignee of the parcel's assignments (`mortgage_party`, `medium`).

When method 3 leaves more than one plausible candidate, each SHALL be stored with confidence `low`. The chosen mortgage SHALL have role `FORECLOSED_MORTGAGE`.

#### Scenario: Mortgage from the parcel sweep

- **WHEN** the parcel sweep returns two mortgages by the defendant, recorded in 2014 and 2021, and the lis pendens was recorded in 2026
- **THEN** the 2021 mortgage is stored as `FORECLOSED_MORTGAGE`/`high` with `matchedBy` `parcel`

#### Scenario: Ambiguous candidates by name

- **WHEN** no block/lot is known and a name search returns two mortgages whose mortgagees both plausibly match the plaintiff
- **THEN** both are stored as `FORECLOSED_MORTGAGE` with confidence `low`

### Requirement: Per-listing failure isolation and run summary

A failure looking up one listing SHALL be logged with its listing ID and county, recorded in its lookup state as an `error` outcome, and SHALL NOT stop other listings. A county SHALL count as failed when its host is blocked for the run or when every attempted lookup in it failed. At the end of each run, the module SHALL log a summary per county: listings attempted, lis pendens matched, no lis pendens, errors, parse errors, truncated searches, and unmapped doc-type descriptions. A listing whose lookup is still in progress at `RUN_DEADLINE_MS` (780 s) SHALL be left due and SHALL NOT be recorded as an error.

#### Scenario: One listing errors

- **WHEN** 40 Monmouth listings are looked up and one search times out twice
- **THEN** that listing's lookup state records an `error`, the other 39 are processed, and Monmouth does not count as failed

#### Scenario: Unmapped doc type

- **WHEN** a result row's Type is a description missing from the county's map
- **THEN** the document is stored with category `OTHER` and the description appears in the run summary's unmapped list
