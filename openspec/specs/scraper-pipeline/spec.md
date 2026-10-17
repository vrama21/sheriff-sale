# scraper-pipeline Specification

## Purpose
TBD - created by archiving change fix-scraper-db-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Bounded listing concurrency

The scraper SHALL process listing details (detail-page fetch, S3 archive, and parse) through a single concurrency limiter shared by all counties in a run. At most `LISTING_CONCURRENCY` (8) listings SHALL be in flight at any time across the whole run.

#### Scenario: Many listings across counties

- **WHEN** a run discovers about 1,300 property IDs across 14 counties running in parallel
- **THEN** no more than 8 listing-detail tasks are active at once, and every property ID is eventually processed

#### Scenario: Limiter preserves results and errors

- **WHEN** a task passed to the limiter resolves or rejects
- **THEN** the limiter's returned promise resolves or rejects with the same value, and the next queued task starts

### Requirement: Per-listing failure isolation

A listing whose detail fetch or parse fails SHALL be logged with its `propertyId` and county and skipped. It SHALL NOT stop the county's other listings from being parsed or written to the database. No per-listing rejection SHALL be left unhandled.

#### Scenario: One listing fails to parse

- **WHEN** a county has 100 listings and one listing's detail HTML fails to parse
- **THEN** the other 99 listings are parsed and the county goes on to the database stage with them, and the failure is logged with that listing's `propertyId`

#### Scenario: Detail request fails

- **WHEN** the detail request for a listing fails (network error or non-2xx status)
- **THEN** the request rejects with the underlying HTTP error rather than resolving with an error object, and the listing is logged and skipped

#### Scenario: Empty detail response

- **WHEN** a listing's detail response has an empty or non-string body
- **THEN** fetching that listing fails with an error that names the `propertyId`, and the listing is skipped

#### Scenario: Detail request hangs

- **WHEN** a listing's detail request gets no response within the request timeout (30 s)
- **THEN** the request rejects with a timeout error, the listing is logged and skipped, and its limiter slot frees for the next listing

### Requirement: Best-effort HTML archive

The scraper SHALL decode each listing's detail HTML once, and SHALL archive that HTML to S3 before parsing it. If the archive fails, the scraper SHALL log the error and go on to parse and save the listing. The archive SHALL write with a single `PutObject` and SHALL NOT read from the bucket first.

#### Scenario: S3 archive fails

- **WHEN** saving a listing's HTML to S3 throws
- **THEN** the error is logged and the listing is still parsed and written to the database

#### Scenario: Archive already exists

- **WHEN** today's archive key for a listing already exists in the bucket, for example on a retry
- **THEN** the save overwrites it with the new HTML, without reading from the bucket first

### Requirement: County failure rule

A county run SHALL fail (reject) when any of these holds: its listings page can't be fetched or parsed; it found at least one listing and none parsed; or it attempted at least one database write and every write failed. In every other case it SHALL resolve, and log a summary of listings found, parsed, failed, inserted, and failed writes.

#### Scenario: Partial listing failures

- **WHEN** a county finds 100 listings, 97 parse, and 3 fail
- **THEN** the county resolves, its new listings are inserted, and the summary logs 3 failed listings

#### Scenario: Every listing fails

- **WHEN** a county finds one or more listings and every one fails to fetch or parse
- **THEN** the county rejects with an error naming the county

#### Scenario: Every database write fails

- **WHEN** a county attempts one or more listing writes and every write fails
- **THEN** the county rejects with an error naming the county

#### Scenario: County with no listings

- **WHEN** a county's listings page parses to zero property IDs
- **THEN** the county resolves with nothing to write

### Requirement: Run fails when any county fails

The scraper handler SHALL run all counties to completion, whether or not some fail. It SHALL then throw an error that names every failed county whenever at least one county failed, so that Lambda async retries and the dead-letter queue engage. It SHALL return a success message only when every county succeeded.

#### Scenario: All counties succeed

- **WHEN** every county resolves
- **THEN** the handler returns `New Jersey Sheriff Sale Scraper ran successfully.`

#### Scenario: One county fails

- **WHEN** one county rejects and the other 13 resolve
- **THEN** the other 13 counties' listings are still written, each failure cause is logged, and the handler throws an error that names the failed county

### Requirement: Database health check

Before scraping any county, the scraper handler SHALL run a trivial database query (`SELECT 1`). If the query fails, the handler SHALL log that the database health check failed, with the cause, and throw without scraping.

#### Scenario: Database unreachable

- **WHEN** the health-check query rejects
- **THEN** the handler logs `Database health check failed` with the cause and throws, and no county is scraped

#### Scenario: Database reachable

- **WHEN** the health-check query succeeds
- **THEN** the handler goes on to scrape the counties

