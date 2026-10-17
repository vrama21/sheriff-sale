# listing-sync Specification

## Purpose
TBD - created by archiving change replay-archived-listings. Update Purpose after archive.
## Requirements
### Requirement: Listing identity is county and sheriff number

A listing SHALL be identified by its county and its sheriff number with all whitespace removed. A sheriff number that is blank once its whitespace is removed SHALL be stored as NULL. The database SHALL enforce at most one `Listing` row per `(county, sheriffId)` among rows whose `sheriffId` is not NULL. `propertyId` SHALL NOT identify a listing; it SHALL hold the site ID from the snapshot the row's fields came from, and SHALL NOT be unique.

#### Scenario: Same sale under a new property ID

- **WHEN** a Gloucester snapshot with sheriff number `F-24000056` and `propertyId` 2195502430 is synced, and a Gloucester row with sheriff number `F-24000056` and `propertyId` 1319120858 exists
- **THEN** no new row is inserted, and the existing row is the one considered for update

#### Scenario: Sheriff number with padding

- **WHEN** a snapshot's sheriff number is `\r F-24000056   `
- **THEN** it is stored and matched as `F-24000056`

#### Scenario: Same sheriff number in two counties

- **WHEN** an Atlantic snapshot and a Hudson snapshot both have sheriff number `20058093`
- **THEN** they are stored as two listings

#### Scenario: Snapshot without a sheriff number

- **WHEN** a parsed snapshot has a blank or missing sheriff number
- **THEN** nothing is written for it, and the sync reports it as skipped for having no sheriff number

### Requirement: Listing fields update only on change from a newer snapshot

Every synced snapshot SHALL carry a snapshot date: the archive date of its page. A snapshot's fields SHALL be the page's fields as listing validation (`listingSchema`) checks and coerces them, with any it can't coerce set by its rules and reported as field warnings. A listing's `contentHash` SHALL be a hash of those fields, excluding `propertyId`, `snapshotDate`, `contentHash` and timestamps. When no row exists for the listing, the sync SHALL insert one with the snapshot's fields, `propertyId`, `contentHash` and `snapshotDate`. When a row exists, the sync SHALL update its fields, `propertyId`, `contentHash`, `snapshotDate` and `updatedAt` only if the snapshot's hash differs from the stored `contentHash` and the snapshot's date is on or after the stored `snapshotDate` (or the stored `snapshotDate` is null). Otherwise the `Listing` row SHALL NOT be written.

#### Scenario: New listing

- **WHEN** a snapshot dated 2025-03-01 is synced and no row exists for its county and sheriff number
- **THEN** a row is inserted with `snapshotDate` 2025-03-01 and the snapshot's hash, and the sync reports "inserted"

#### Scenario: Newer snapshot with changed fields

- **WHEN** a row with `snapshotDate` 2025-03-01 exists and a snapshot dated 2025-03-08 with a different upset amount is synced
- **THEN** the row takes the new fields, `propertyId`, hash and `snapshotDate` 2025-03-08, `updatedAt` changes, and the sync reports "updated"

#### Scenario: Newer snapshot with the same fields

- **WHEN** a row exists and a newer snapshot whose fields hash to the stored `contentHash` is synced
- **THEN** the `Listing` row is not written, and the sync reports "unchanged"

#### Scenario: Older snapshot replayed after a newer one

- **WHEN** a row with `snapshotDate` 2025-06-10 exists and a snapshot dated 2025-03-29 with different fields is synced
- **THEN** the `Listing` row is not written, and the sync reports "unchanged"

#### Scenario: Only the property ID differs

- **WHEN** a newer snapshot differs from the stored row only in `propertyId`
- **THEN** the `Listing` row is not written

### Requirement: Status history is merged across snapshots

Each status row SHALL be stored with its status normalized (whitespace runs collapsed and ends trimmed) and its date as listing validation gives it: a `M/D/YYYY` date, with any time of day dropped, as the date `YYYY-MM-DD`. A row whose status is empty or whose date listing validation rejects SHALL NOT be stored, and SHALL be reported as a field warning. The database SHALL enforce at most one `StatusHistory` row per `(listingId, status, date)`. For every row on a synced snapshot, the sync SHALL insert it with `firstSeenOn` and `lastSeenOn` set to the snapshot date, or, if it exists, move `firstSeenOn` earlier or `lastSeenOn` later when the snapshot date lies outside them. The sync SHALL NOT delete status rows. Status rows SHALL be merged whether or not the `Listing` row was written.

#### Scenario: Row seen for the first time

- **WHEN** a snapshot dated 2025-06-10 shows `Cancelled | 4/9/2025` and the listing has no such row
- **THEN** a row `Cancelled | 2025-04-09` is inserted with `firstSeenOn` and `lastSeenOn` 2025-06-10

#### Scenario: Row seen again later

- **WHEN** a row `Scheduled | 2023-07-20` has `firstSeenOn` 2025-03-29 and `lastSeenOn` 2025-03-29, and a snapshot dated 2025-06-10 shows it
- **THEN** its `lastSeenOn` becomes 2025-06-10 and no row is inserted

#### Scenario: Older snapshot replayed later

- **WHEN** a row has `firstSeenOn` 2025-06-10 and a snapshot dated 2025-03-29 shows it
- **THEN** its `firstSeenOn` becomes 2025-03-29

#### Scenario: Date edited on the site

- **WHEN** a snapshot dated 2025-03-29 shows `ADJOURNED SHERIFF - New Sale Date: | 4/10/2025` and a snapshot dated 2025-06-10 shows `ADJOURNED SHERIFF - New Sale Date: | 3/27/2025` instead
- **THEN** both rows are kept, the first with `lastSeenOn` 2025-03-29 and the second with `lastSeenOn` 2025-06-10

#### Scenario: Date with a time

- **WHEN** a snapshot shows `Adjourned - Court | 10/07/2024 02:00 PM`
- **THEN** the row is stored with date `2024-10-07`

#### Scenario: Date that isn't a date

- **WHEN** a snapshot shows `Cancelled | TBD`
- **THEN** no row is stored for it, and its date is reported as a field warning

#### Scenario: Same row in two formats

- **WHEN** one snapshot shows `Scheduled | 07/20/2023` and another shows `Scheduled | 7/20/2023`
- **THEN** one row `Scheduled | 2023-07-20` exists

### Requirement: Atomic listing sync

A listing's write and its status-history merge SHALL run in one transaction. If any write in it fails, none of them SHALL be stored, and the sync SHALL reject.

#### Scenario: Status merge fails

- **WHEN** the listing upsert succeeds and the status-history merge fails
- **THEN** the transaction rolls back, and neither the listing nor any status row changes

### Requirement: Re-syncing a snapshot writes nothing

Syncing a snapshot that has already been synced SHALL NOT write any `Listing` or `StatusHistory` row.

#### Scenario: Same snapshot twice

- **WHEN** a snapshot is synced and then synced again
- **THEN** the second sync reports "unchanged", inserts no status rows and changes no `firstSeenOn` or `lastSeenOn`

### Requirement: The daily scrape uses the same sync

The scheduled scraper SHALL sync each listing it parses through the same path as the replay, with the snapshot date set to the UTC date it archives the page under. Its county summary SHALL count listings inserted, updated and unchanged, and field warnings.

#### Scenario: Daily scrape of a stored listing

- **WHEN** the daily scrape parses a listing already stored from an earlier day, and its upset amount has changed
- **THEN** the stored row is updated and the county summary counts it as updated

#### Scenario: Daily scrape of an unchanged listing

- **WHEN** the daily scrape parses a stored listing whose fields haven't changed
- **THEN** the `Listing` row isn't written, its status rows' `lastSeenOn` move to today, and the summary counts it as unchanged

### Requirement: Repair of existing listings

Before the unique indexes are created, a migration SHALL, in the same migration run:

- remove whitespace from every `sheriffId`, storing a blank one as NULL;
- normalize every status row's status by the status-history rules;
- set each listing's `snapshotDate`, and each of its status rows' `firstSeenOn` and `lastSeenOn`, to the date of the listing's `createdAt`;
- for each `(county, sheriffId)` with a sheriff number and more than one row, keep the row with the latest `createdAt` (then the highest `id`), move the other rows' status rows to it, and delete the other rows;
- collapse status rows that share `(listingId, status, date)` into one, with the earliest `firstSeenOn` and latest `lastSeenOn`.

Rows without a sheriff number SHALL be left unmerged. A failure SHALL leave the database unchanged.

#### Scenario: Re-scraped sale

- **WHEN** Atlantic `F-24000184` has 14 rows created on 2024-03-13 with identical status rows
- **THEN** after migration one row remains, and each distinct status row exists once with `firstSeenOn` and `lastSeenOn` 2024-03-13

#### Scenario: Sale scraped on two days

- **WHEN** a sale has a row created 2024-01-05 and a row created 2024-02-02
- **THEN** the 2024-02-02 row remains with `snapshotDate` 2024-02-02, and holds the status rows of both, each with the dates of the rows that showed it

#### Scenario: Blank sheriff number

- **WHEN** a Bergen row has a blank or NULL `sheriffId`
- **THEN** after migration it remains with a NULL `sheriffId`, and its status rows normalized

#### Scenario: Unique index fails

- **WHEN** creating either unique index fails
- **THEN** the whole migration run rolls back, including the repair

