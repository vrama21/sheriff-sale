# archive-replay Specification

## Purpose

TBD - created by archiving change replay-archived-listings. Update Purpose after archive.

## Requirements

### Requirement: Replay command

The backend SHALL provide a `replay:archive` command that takes one or more `--county` names, `--from` and `--to` dates (inclusive, `YYYY-MM-DD`), and an optional `--dry-run`. With no `--county`, it SHALL replay every NJ county. It SHALL reject an unknown county, a malformed date or `--from` after `--to` before reading anything. It SHALL process dates in ascending order.

#### Scenario: One county over a range

- **WHEN** the command runs with `--county Atlantic --from 2025-03-01 --to 2025-03-31`
- **THEN** it replays Atlantic's archived pages for each day from 2025-03-01 through 2025-03-31, earliest first

#### Scenario: Unknown county

- **WHEN** the command runs with `--county Atlantis`
- **THEN** it exits with an error naming the county, and reads nothing

#### Scenario: Reversed range

- **WHEN** `--from` is 2025-04-01 and `--to` is 2025-03-01
- **THEN** it exits with an error, and reads nothing

### Requirement: County pages select the detail pages

For each date and county, the replay SHALL read the archived county page `county-html-files/<date>/<county slug>-county.html`, take its property IDs with the county-page parser, and process `listing-html-files/<date>/property-id-<id>.html` for each one, as that county's snapshot for that date. A missing county page or detail page SHALL be counted as missing and SHALL NOT stop the run.

#### Scenario: County page and its detail pages

- **WHEN** Hunterdon's county page for 2025-06-02 lists property IDs 1611111111 and 1611111112, and both detail pages are archived
- **THEN** both detail pages are processed as Hunterdon snapshots dated 2025-06-02

#### Scenario: No county page that day

- **WHEN** there is no archived Salem county page for 2024-07-01
- **THEN** Salem 2024-07-01 is counted as a missing county page, and the run continues

#### Scenario: Detail page not archived

- **WHEN** a county page lists a property ID with no archived detail page that day
- **THEN** it is counted as a missing detail page, and nothing is written for it

### Requirement: Passaic pages before the county-ID fix are Gloucester

On dates on or before 2026-10-17, the archived `passaic` county page SHALL be read as a Gloucester page, because it was fetched with Gloucester's county ID. Replaying Gloucester on those dates SHALL read both the `gloucester` and `passaic` pages. Replaying Passaic on those dates SHALL select nothing and SHALL say so in the summary.

#### Scenario: Gloucester before the fix

- **WHEN** Gloucester is replayed for 2025-05-01
- **THEN** listings from both the `gloucester` and the `passaic` county pages of that day are synced with county Gloucester

#### Scenario: Passaic before the fix

- **WHEN** Passaic is replayed for 2025-05-01
- **THEN** nothing is read or written for Passaic that day, and the summary notes the date was skipped as pre-fix

#### Scenario: Passaic after the fix

- **WHEN** Passaic is replayed for 2026-10-18
- **THEN** the `passaic` county page is read as Passaic

### Requirement: Layout detection

The replay SHALL parse a detail page with the current details parser when it has `.sale-detail-item` elements, with the legacy details parser when it has the old table layout (label cells with class `heading-bold`), and with the current status-history parser in both cases. Pages of both layouts SHALL be validated by the same listing validation as the daily scrape. A page with neither layout SHALL be counted as unrecognised and SHALL NOT be written. A page that fails to parse, or that listing validation rejects (such as one without an address), SHALL be counted as a parse failure, logged with its key, and SHALL NOT be written. A value listing validation coerces or drops SHALL be counted and logged with its key as a field warning, and SHALL NOT stop the page from being synced.

#### Scenario: Current layout

- **WHEN** a detail page dated 2025-06-10 has `.sale-detail-item` elements
- **THEN** it is parsed with the current parser and synced

#### Scenario: Legacy layout

- **WHEN** a detail page dated 2024-07-02 has the table layout with `Sheriff #:` in a `heading-bold` cell
- **THEN** it is parsed with the legacy parser, its address keeps the line break between street and city, and it is synced

#### Scenario: Home page archived as a detail page

- **WHEN** a detail page is the site's home page
- **THEN** it is counted as unrecognised, and nothing is written

### Requirement: Legacy details parsing

The legacy details parser SHALL read each row of the old layout's details table whose first cell has class `heading-bold`, take that cell's text without the trailing colon as the label and the next cell as the value, and map labels to listing fields the same way as the current parser. Values SHALL be decoded and whitespace-collapsed like the current parser's, with `<br>` kept as a line break in the address. Like the current parser, it SHALL return the values as text, leaving labels that aren't listing fields to listing validation, which drops them with a field warning.

#### Scenario: Legacy page fields

- **WHEN** a legacy page has `Sheriff #: F-24000056`, `Sales Date: 07/15/2024 02:00 PM`, `Approx. Upset*: $275,983.46` and `Address: 263 Three Bridge Road<br/>Monroeville NJ 08343`
- **THEN** the parse has `sheriffId` `F-24000056`, `saleDate` `07/15/2024 02:00 PM`, `upsetAmount` `$275,983.46`, and an address that `parseAddress` splits into street `263 Three Bridge Road`, city `Monroeville` and ZIP `08343`

### Requirement: Dry run

With `--dry-run`, the replay SHALL read and parse the selected pages and report the same page counts as a real run, and SHALL NOT write to the database.

#### Scenario: Dry run over a range

- **WHEN** the command runs with `--dry-run` over a range
- **THEN** the summary reports county pages, detail pages, missing, unrecognised, parse failures, pages without a sheriff number and field warnings, and no database row changes

### Requirement: Run summary and failures

The replay SHALL print a summary per county and for the whole run: county pages read and missing, detail pages found, missing, unrecognised, failed to parse and without a sheriff number, field warnings, listings inserted, updated and unchanged, and status rows inserted and extended. A failed S3 read other than a missing key, or a failed sync, SHALL be logged with its key and counted, and SHALL NOT stop the run. The command SHALL exit non-zero if any read or sync failed.

#### Scenario: Re-running a replayed range

- **WHEN** a range is replayed and then replayed again with no new archive pages
- **THEN** the second summary reports 0 inserted, 0 updated, 0 status rows inserted and 0 extended

#### Scenario: Database write fails for one listing

- **WHEN** one listing's sync rejects
- **THEN** it is logged and counted as failed, the other listings are synced, and the command exits non-zero
