## ADDED Requirements

### Requirement: A listing may have no property ID

A snapshot's `propertyId` SHALL be either a CivilView property ID or NULL. Ocean snapshots, which come from a PDF, SHALL have it NULL. `Listing.propertyId` SHALL be nullable in the database. Its leftover Prisma-era NOT NULL SHALL be dropped by an expand-only custom migration. A NULL `propertyId` SHALL NOT affect identity, which stays county and sheriff number, or the content hash.

#### Scenario: Ocean listing inserted

- **WHEN** an Ocean snapshot with `sheriffId` `CH778323` and `propertyId` NULL is synced, and no Ocean row with that sheriff number exists
- **THEN** a `Listing` row is inserted with `propertyId` NULL, and the sync reports "inserted"

#### Scenario: Ocean listing unchanged

- **WHEN** the same Ocean snapshot is synced again the next day with the same fields
- **THEN** the sync reports "unchanged", and the listing's status row widens its `lastSeenOn`
