## MODIFIED Requirements

### Requirement: County pages select the detail pages

For each date, the replay SHALL list the archived keys under `listing-html-files/<date>/` once, before reading that date's county pages. For each county, it SHALL read the archived county page `county-html-files/<date>/<county slug>-county.html`, take its property IDs with the county-page parser, and process `listing-html-files/<date>/property-id-<id>.html` for each listed ID, as that county's snapshot for that date. It SHALL read a detail page only when its key is in that day's listing; a listed ID with no key SHALL be counted as a missing detail page without a read. A missing county page or detail page SHALL be counted as missing and SHALL NOT stop the run. A failed listing of a date's keys SHALL be logged and counted as a failed read, and that date's detail pages SHALL then be read without the listing, as before.

#### Scenario: County page and its detail pages

- **WHEN** Hunterdon's county page for 2025-06-02 lists property IDs 1611111111 and 1611111112, and both detail pages are archived
- **THEN** both detail pages are processed as Hunterdon snapshots dated 2025-06-02

#### Scenario: No county page that day

- **WHEN** there is no archived Salem county page for 2024-07-01
- **THEN** Salem 2024-07-01 is counted as a missing county page, and the run continues

#### Scenario: Detail page not archived

- **WHEN** a county page lists a property ID with no archived detail page that day
- **THEN** it is counted as a missing detail page, no S3 read is made for it, and nothing is written for it

#### Scenario: Day's listing fails

- **WHEN** listing `listing-html-files/2025-01-02/` fails with an error
- **THEN** the error is logged and counted as a failed read, that day's detail pages are read key by key, and the command exits non-zero

#### Scenario: Full-range dry run

- **WHEN** the command runs with `--dry-run --from 2024-10-23 --to 2026-10-18`
- **THEN** it makes one listing request per day plus one read per archived county page and detail page, and reports the same found and missing counts as reading every listed key

## ADDED Requirements

### Requirement: Replay database pool size

The database client SHALL size its connection pool from `DATABASE_POOL_MAX`, a positive integer, and SHALL use a single connection when it is unset. The replay SHALL set it to its detail-page concurrency unless the environment already sets it, so its syncs run in parallel. The scraper Lambda's environment SHALL NOT set it.

#### Scenario: Lambda default

- **WHEN** the scraper Lambda runs with only `DATABASE_URL` set
- **THEN** the client opens at most one connection

#### Scenario: Replay runs syncs in parallel

- **WHEN** the replay runs without `--dry-run` and `DATABASE_POOL_MAX` unset
- **THEN** the client's pool size equals the replay's detail-page concurrency

#### Scenario: Invalid value

- **WHEN** `DATABASE_POOL_MAX` is `0` or `abc`
- **THEN** importing the database client throws an error naming `DATABASE_POOL_MAX`
