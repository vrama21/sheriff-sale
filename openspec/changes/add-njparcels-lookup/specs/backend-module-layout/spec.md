## MODIFIED Requirements

### Requirement: Domain modules and shared code

The backend's source SHALL live in two places under `backend/src/`: `modules/<module>/`, one folder per domain pipeline, and `shared/`, code that any module may use. No other top-level folder under `backend/src/` SHALL hold source files. The sheriff-sale pipeline SHALL be the module `modules/sheriffSale/`, and the njparcels lookup SHALL be the module `modules/njParcels/`. `shared/` SHALL contain:

- `nj/`, with:
  - `NJ_COUNTIES`, `NJCounty` and the county state codes;
  - the municipality map and the script that regenerates it;
  - the postal-place aliases and `resolveMunicipality`;
  - `extractParcel`, `normalizeParcelValue` and `sameParcel`.
- `address/`
- `http/` (`HttpClient`)
- `s3/`
- `concurrency/` (`createConcurrencyLimiter`)

#### Scenario: Top-level layout

- **WHEN** the folders directly under `backend/src/` are listed
- **THEN** they are `modules` and `shared`, and `backend/scripts/` does not exist

#### Scenario: Sheriff-sale code in one module

- **WHEN** the civilview client, the county-ID map, the listing parsers, `listingSchema`, `buildListingSnapshot`, `syncListing`, the county pipeline, the Lambda handler and the archive replay are located
- **THEN** every one of them is under `backend/src/modules/sheriffSale/`

#### Scenario: NJ geography is shared

- **WHEN** the municipality map, `resolveMunicipality` and `extractParcel` are located
- **THEN** every one of them is under `backend/src/shared/nj/`, and none imports from `backend/src/modules/`
