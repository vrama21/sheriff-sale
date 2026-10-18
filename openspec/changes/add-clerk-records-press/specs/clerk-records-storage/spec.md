## ADDED Requirements

### Requirement: Clerk document identity

Each recorded document SHALL be stored once per county in `ClerkDocument`, identified by `(county, instrumentNumber)` under a unique index. A document with no instrument number SHALL use the synthetic key `BK:<book>/<page>`. Each row SHALL store the platform it came from, the canonical `docCategory`, the raw doc type description, the recorded date, book type, book, page, municipality, block, lot and qualifier. It SHALL also store the consideration and a `detail` JSON object when the platform provides them, and `firstSeenAt` and `lastSeenAt`.

#### Scenario: Same document from two searches

- **WHEN** instrument `2026042459` in Passaic is returned by both a name search and a parcel search in one run
- **THEN** there is exactly one `ClerkDocument` row for it

#### Scenario: Book-only record

- **WHEN** a result row has no instrument number but has book `5120` and page `88`
- **THEN** the document is stored with instrument key `BK:5120/88`

### Requirement: Non-destructive document upsert

Writing a document that already exists SHALL update `lastSeenAt`, and SHALL fill columns that are null with values that are now present. It SHALL NOT overwrite a non-null column with null. Parties SHALL be stored in `ClerkDocumentParty` with their side (`direct` or `indirect`), raw name and normalized name, unique by `(documentId, side, name)`. Cross-references SHALL be stored in `ClerkDocumentLink` by target instrument number or book and page, unique per source document and target. A link's `toDocumentId` SHALL be set once the target document is stored. Party and link writes SHALL insert only missing rows.

#### Scenario: Detail fills in later

- **WHEN** a document first stored from a result grid without consideration is later seen with a detail view showing consideration 712500
- **THEN** its `consideration` becomes 712500 and its other columns are unchanged

#### Scenario: Sparser row does not erase data

- **WHEN** a document stored with block `522` is seen again in a row whose block cell is `N/A`
- **THEN** its block stays `522`

### Requirement: Listing-to-document matches

Each match SHALL be stored in `ListingClerkDocument`, unique by `(listingId, documentId)`, with a `role`, `matchedBy` and `confidence`, `firstMatchedAt` and `lastConfirmedAt`:

- `role`: `FORECLOSED_LIS_PENDENS`, `FORECLOSED_MORTGAGE`, `MORTGAGE_ASSIGNMENT`, `PRIOR_DEED`, `SHERIFF_DEED` or `RELATED`
- `matchedBy`: `lis_pendens_party`, `parcel`, `cross_reference` or `mortgage_party`
- `confidence`: `high`, `medium` or `low`

Re-matching an existing pair SHALL update its role, method, confidence and `lastConfirmedAt`. A match SHALL NOT be deleted because a later run did not return its document.

#### Scenario: Re-check confirms a match

- **WHEN** a re-check matches the same lis pendens to the same listing again
- **THEN** the existing match row's `lastConfirmedAt` advances and no new row is created

#### Scenario: Document missing from a later search

- **WHEN** a later run's searches don't return a previously matched document
- **THEN** the match row is kept unchanged

### Requirement: Per-listing lookup state

`ListingClerkLookup` SHALL hold one row per looked-up listing, keyed by `listingId`, with the platform, `lastCheckedAt`, `nextCheckAt` (null when no further checks are due), `lastOutcome`, `consecutiveMisses`, `consecutiveErrors` and `lastError`. `lastOutcome` SHALL be one of `matched`, `no_lis_pendens`, `unsupported`, `error` or `complete`.

#### Scenario: Outcome recorded

- **WHEN** a lookup finds no lis pendens for a listing that had one previous miss
- **THEN** its row shows `lastOutcome` `no_lis_pendens`, `consecutiveMisses` 2, and a `nextCheckAt` 7 days after `lastCheckedAt`

### Requirement: Atomic per-listing write

A listing's documents, parties, links, matches and lookup state from one lookup SHALL be written in a single transaction. A failure partway through SHALL leave none of that lookup's rows written. Writing the same lookup result twice SHALL leave the database as it was after the first write, apart from `lastSeenAt`, `lastConfirmedAt` and `lastCheckedAt`.

#### Scenario: Write fails partway

- **WHEN** inserting a match fails after the documents were inserted in the same lookup
- **THEN** the transaction rolls back, and the listing's lookup is recorded as an error by a separate write

#### Scenario: Idempotent re-run

- **WHEN** the same lookup result is written twice
- **THEN** no rows are added by the second write

### Requirement: Referential integrity

`ClerkDocumentParty.documentId` and `ClerkDocumentLink.fromDocumentId` SHALL reference `ClerkDocument` with cascade delete. `ListingClerkDocument.listingId` and `ListingClerkLookup.listingId` SHALL reference `Listing` with cascade delete, and `ListingClerkDocument.documentId` SHALL reference `ClerkDocument` with cascade delete. The tables SHALL be created by a generated, expand-only Drizzle migration committed to `packages/database/drizzle/`.

#### Scenario: Listing removed by a repair migration

- **WHEN** a duplicate `Listing` row is deleted
- **THEN** its `ListingClerkDocument` and `ListingClerkLookup` rows are deleted with it, and the `ClerkDocument` rows remain
