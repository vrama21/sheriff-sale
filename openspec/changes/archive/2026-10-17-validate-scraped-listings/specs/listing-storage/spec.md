## MODIFIED Requirements

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

## ADDED Requirements

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
