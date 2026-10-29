## MODIFIED Requirements

### Requirement: Listing fields update only on change from a newer snapshot

Every synced snapshot SHALL carry a snapshot date: the archive date of its page. A snapshot's fields SHALL be the page's fields as listing validation (`listingSchema`) checks and coerces them, with any it can't coerce set by its rules and reported as field warnings. They SHALL also include the parcel fields `municipalityCode`, `block`, `lot`, `qualifier` and `pamsPin`, derived from those fields by the listing-parcel rules. A listing's `contentHash` SHALL be a hash of those fields, excluding `propertyId`, `snapshotDate`, `contentHash` and timestamps. When no row exists for the listing, the sync SHALL insert one with the snapshot's fields, `propertyId`, `contentHash` and `snapshotDate`. When a row exists, the sync SHALL update its fields, `propertyId`, `contentHash`, `snapshotDate` and `updatedAt` only if the snapshot's hash differs from the stored `contentHash` and the snapshot's date is on or after the stored `snapshotDate` (or the stored `snapshotDate` is null). Otherwise the `Listing` row SHALL NOT be written.

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

#### Scenario: Resolver change reaches a scraped listing

- **WHEN** an alias is added that resolves a listing's municipality, and a newer snapshot of that listing is otherwise unchanged
- **THEN** the row takes the new `municipalityCode` and `pamsPin`, and the sync reports "updated"
