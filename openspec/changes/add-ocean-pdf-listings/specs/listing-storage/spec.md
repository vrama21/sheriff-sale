## MODIFIED Requirements

### Requirement: Columns fit the site's values

The `Listing` table SHALL store `propertyId` as a 64-bit integer, and SHALL store `sheriffId` and the scraped free-text fields (`address`, `attorney`, `courtCase`, `deed`, `deedAddress`, `defendant`, `description`, `parcel`, `plaintiff`, `priors`) as unbounded text. It SHALL store `upsetAmount` and `judgment` as exact decimals with two fraction digits (`numeric(12,2)`), read back as numbers, and SHALL store `saleDate` as a calendar date. `StatusHistory.date` SHALL be a calendar date. `propertyId`, `address`, `saleDate`, `plaintiff`, `sheriffId`, `upsetAmount` and `judgment` SHALL be nullable. (`address` has been nullable since `0013`, and the spec hadn't caught up.)

#### Scenario: Large property ID

- **WHEN** a listing with `propertyId` 2195502430 is saved
- **THEN** it is stored and can be looked up by that ID

#### Scenario: Listing without a property ID

- **WHEN** an Ocean listing with `propertyId` NULL is saved
- **THEN** the insert succeeds, and `propertyId` is NULL

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

## REMOVED Requirements

### Requirement: One listing per property ID

**Reason**: It has been stale since `0009` dropped `Listing_propertyId_key`. Identity is county and sheriff number (`Listing_county_sheriffId_key`, `listing-sync`), and CivilView's `propertyId` changes between searches. Ocean listings have no `propertyId` at all, so a uniqueness rule on it can't hold.
**Migration**: None needed. Prod has no index on `propertyId`. This change's custom migration drops the column's leftover NOT NULL.
