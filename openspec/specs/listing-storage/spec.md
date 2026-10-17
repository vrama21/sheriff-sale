# listing-storage Specification

## Purpose
TBD - created by archiving change listing-schema-fixes. Update Purpose after archive.
## Requirements
### Requirement: Columns fit the site's values

The `Listing` table SHALL store `propertyId` as a 64-bit integer, and SHALL store `sheriffId` and the scraped free-text fields (`address`, `attorney`, `courtCase`, `deed`, `deedAddress`, `defendant`, `description`, `parcel`, `plaintiff`, `priors`) as unbounded text. It SHALL store `upsetAmount` and `judgment` as exact decimals with two fraction digits (`numeric(12,2)`), read back as numbers, and SHALL store `saleDate` as a calendar date. `StatusHistory.date` SHALL be a calendar date. `saleDate`, `plaintiff`, `sheriffId`, `upsetAmount` and `judgment` SHALL be nullable.

#### Scenario: Large property ID

- **WHEN** a listing with `propertyId` 2195502430 is saved
- **THEN** it is stored and can be looked up by that ID

#### Scenario: Sheriff number with letters

- **WHEN** a listing with `sheriffId` `F-23001318` is saved
- **THEN** `sheriffId` is stored as `F-23001318`

#### Scenario: Long description

- **WHEN** a listing's description is 3,300 characters
- **THEN** the full description is stored

#### Scenario: Amount reads back as a number

- **WHEN** a listing saved with `upsetAmount` `1585.95` is read through `db.query.listings`
- **THEN** `upsetAmount` is the JS number `1585.95`

#### Scenario: Sale date reads back as an ISO date

- **WHEN** a listing saved with `saleDate` 2024-08-12 is read through `db.query.listings`
- **THEN** `saleDate` is the string `2024-08-12`

#### Scenario: Listing without a sale date

- **WHEN** a listing with no sale date is saved
- **THEN** the insert succeeds, and `saleDate` is NULL

### Requirement: One listing per property ID

The database SHALL enforce at most one `Listing` row per `propertyId`. Saving a listing whose `propertyId` is already stored SHALL leave the stored row unchanged, and SHALL report that nothing was inserted.

#### Scenario: Listing already stored

- **WHEN** a listing is saved and a row with the same `propertyId` exists
- **THEN** no listing or status-history rows are written, and the save reports "not inserted"

#### Scenario: Concurrent saves of the same listing

- **WHEN** two saves of the same `propertyId` run at the same time
- **THEN** exactly one `Listing` row exists afterwards, with one set of status-history rows

### Requirement: Atomic listing write

A listing and all of its status-history rows SHALL be written in one transaction. If any of those writes fails, none of them SHALL be stored.

#### Scenario: Status-history insert fails

- **WHEN** the listing insert succeeds and its status-history insert fails
- **THEN** the transaction rolls back, no `Listing` row exists for that `propertyId`, and the save rejects

#### Scenario: Listing with no status history

- **WHEN** a new listing has no status-history rows
- **THEN** the listing is stored and the save reports "inserted"

### Requirement: Repair of duplicate and mislabelled listings

Before the unique index is created, a migration SHALL relabel every listing whose county is `Passaic` to `Gloucester`. It SHALL then keep only the oldest listing per `propertyId` (by `createdAt`, then `id`), deleting the others and their status-history rows. The repair and the index SHALL be applied in the same migration run, so a failure leaves the database unchanged.

#### Scenario: Mislabelled duplicate

- **WHEN** `propertyId` 2195453969 has a Gloucester row created first and a Passaic row created later
- **THEN** after migration, only the Gloucester row and its status history remain

#### Scenario: Re-run copy

- **WHEN** a `propertyId` has a row created first and a later copy of it within the same county
- **THEN** after migration, only the first row and its status history remain

#### Scenario: Mislabelled single row

- **WHEN** a `propertyId` has only a row labelled Passaic
- **THEN** after migration, that row remains, labelled Gloucester

#### Scenario: Duplicates left behind

- **WHEN** creating the unique index fails because duplicates remain
- **THEN** the whole migration run rolls back, including the repair

### Requirement: Existing rows are converted with the parser's rules

The migration that changes the column types SHALL first normalize the existing prod rows with the same rules the parser applies to new listings: text normalization, `attorneyPhone` normalization, empty → NULL (except `address`, which stays NOT NULL), out-of-range years → NULL for `saleDate`, and deletion of status-history rows whose date is invalid. It SHALL then convert `upsetAmount`, `judgment`, `saleDate` and `StatusHistory.date` with explicit `USING` casts, so no value that parses is lost.

#### Scenario: Money converts losslessly

- **WHEN** the migration runs on a row with `upsetAmount` `"\r $1,558.73                    "`
- **THEN** the row's `upsetAmount` is `1558.73`

#### Scenario: Zero survives conversion

- **WHEN** the migration runs on a row with `upsetAmount` `$0.00`
- **THEN** the row's `upsetAmount` is `0`

#### Scenario: Year-3021 rows

- **WHEN** the migration runs on prod
- **THEN** the two Hunterdon listings dated `4/30/3021` have NULL `saleDate`, and their status-history rows dated 3021 are deleted

#### Scenario: Dirty text cleaned in place

- **WHEN** the migration runs on a row with `attorneyPhone` `"\r (973) 575-0707                    "`
- **THEN** the row's `attorneyPhone` is `(973) 575-0707`

