## ADDED Requirements

### Requirement: Parcel extraction is shared

`extractParcel`, `normalizeParcelValue` and `sameParcel` SHALL live in `shared/nj`, and clerk-records matching SHALL import them from there. Their behaviour SHALL NOT change: block, lot, extra lots and qualifier come from `parcel` first, then `description`; boundary references to neighbouring lots are skipped; and text that names no parcel gives null.

#### Scenario: Clerk records uses the shared extractor

- **WHEN** the imports of `modules/clerkRecords/` are listed
- **THEN** `extractParcel` resolves to `shared/nj`, and no `extractParcel.ts` exists under `modules/clerkRecords/`

#### Scenario: Behaviour unchanged

- **WHEN** the existing `extractParcel` tests run against the moved file
- **THEN** they pass unchanged

### Requirement: Parcel columns on Listing

`Listing` SHALL have nullable text columns `municipalityCode`, `block`, `lot`, `qualifier` and `pamsPin`, and an index on `pamsPin`.

#### Scenario: Migration

- **WHEN** the Drizzle migration runs on the prod schema
- **THEN** the five columns exist, every existing row has NULL in them, and `pamsPin` is indexed

### Requirement: Ingest sets the parcel fields

Every listing snapshot SHALL carry the five parcel fields, set from the snapshot's own `county`, `parcel`, `description` and `city`:

- `municipalityCode` SHALL be `resolveMunicipality`'s code.
- `block`, `lot` and `qualifier` SHALL be `extractParcel`'s block, first lot and qualifier, each normalized with `normalizeParcelValue`.
- `pamsPin` SHALL be `<municipalityCode>_<block>_<lot>` with the qualifier suffix the condo spike settles on. It SHALL be set only when the code, block and lot are all present, and when the qualifier, if any, can be expressed.

Fields the text doesn't support SHALL be NULL.

#### Scenario: Fully resolved listing

- **WHEN** an Essex listing whose city is "Newark" and whose description names "Block 2001, Lot 1" is snapshotted
- **THEN** its `municipalityCode` is `0714`, `block` `2001`, `lot` `1`, and `pamsPin` `0714_2001_1`

#### Scenario: Leading zeros

- **WHEN** a listing's text names "Block 049.04, Lot 007"
- **THEN** `block` is `49.04` and `lot` is `7`

#### Scenario: No block in the notice

- **WHEN** an Atlantic listing's text names no block or lot
- **THEN** `block`, `lot` and `pamsPin` are NULL, and `municipalityCode` is still set if it resolves

#### Scenario: Unresolved municipality

- **WHEN** a listing has a block and lot but its municipality doesn't resolve
- **THEN** `block` and `lot` are set and `municipalityCode` and `pamsPin` are NULL

#### Scenario: Multi-lot notice

- **WHEN** a listing names "Lots 21 & 22, Block 5"
- **THEN** `lot` is `21` and `pamsPin` uses lot `21`

### Requirement: Backfill of existing listings

A re-runnable script SHALL recompute the five parcel fields for every `Listing` row from its stored `county`, `parcel`, `description` and `city`. It SHALL write only rows whose stored values differ, in batches. It SHALL NOT change `contentHash`, `snapshotDate` or `updatedAt`. It SHALL print, per county, the counts of rows with a `pamsPin`, a municipality code by source, and no municipality code, and the most frequent unresolved cities.

#### Scenario: First run

- **WHEN** the script runs after the migration
- **THEN** rows whose text supports a parcel get their fields, and their `updatedAt` is unchanged

#### Scenario: Re-run with nothing new

- **WHEN** the script runs again with no change to the resolver or aliases
- **THEN** it writes no rows

#### Scenario: Re-run after adding an alias

- **WHEN** an alias for "Sewell" is added and the script runs
- **THEN** only the Gloucester rows with city "Sewell" are written
