## ADDED Requirements

### Requirement: Columns fit the site's values

The `Listing` table SHALL store `propertyId` as a 64-bit integer, and SHALL store `sheriffId` and the scraped free-text fields (`address`, `attorney`, `courtCase`, `deed`, `deedAddress`, `defendant`, `description`, `judgment`, `parcel`, `plaintiff`, `priors`, `upsetAmount`) as unbounded text.

#### Scenario: Large property ID

- **WHEN** a listing with `propertyId` 2195502430 is saved
- **THEN** it is stored and can be looked up by that ID

#### Scenario: Sheriff number with letters

- **WHEN** a listing with `sheriffId` `F-23001318` is saved
- **THEN** `sheriffId` is stored as `F-23001318`

#### Scenario: Long description

- **WHEN** a listing's description is 3,300 characters
- **THEN** the full description is stored

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

### Requirement: Repair of Passaic and Gloucester duplicates

Before the unique index is created, a migration SHALL relabel every listing whose county is `Passaic` to `Gloucester`. It SHALL then keep only the oldest listing per `propertyId` (by `createdAt`, then `id`), deleting the others and their status-history rows. The repair and the index SHALL be applied in the same migration run, so a failure leaves the database unchanged.

#### Scenario: Mislabelled duplicate

- **WHEN** `propertyId` 2195453969 has a Gloucester row created first and a Passaic row created later
- **THEN** after migration, only the Gloucester row and its status history remain

#### Scenario: Mislabelled single row

- **WHEN** a `propertyId` has only a row labelled Passaic
- **THEN** after migration, that row remains, labelled Gloucester

#### Scenario: Duplicates left behind

- **WHEN** creating the unique index fails because duplicates remain
- **THEN** the whole migration run rolls back, including the repair
