# backend-module-layout Specification

## Purpose
TBD - created by archiving change isolate-sheriff-sale-module. Update Purpose after archive.
## Requirements
### Requirement: Domain modules and shared code

The backend's source SHALL live in two places under `backend/src/`: `modules/<module>/`, one folder per domain pipeline, and `shared/`, code that any module may use. No other top-level folder under `backend/src/` SHALL hold source files. The sheriff-sale pipeline SHALL be the module `modules/sheriffSale/`. `shared/` SHALL contain `nj/` (`NJ_COUNTIES`, `NJCounty`), `address/`, `http/` (`HttpClient`), `s3/` and `concurrency/` (`createConcurrencyLimiter`).

#### Scenario: Top-level layout

- **WHEN** the folders directly under `backend/src/` are listed
- **THEN** they are `modules` and `shared`, and `backend/scripts/` does not exist

#### Scenario: Sheriff-sale code in one module

- **WHEN** the civilview client, the county-ID map, the listing parsers, `listingSchema`, `buildListingSnapshot`, `syncListing`, the county pipeline, the Lambda handler and the archive replay are located
- **THEN** every one of them is under `backend/src/modules/sheriffSale/`

### Requirement: Module shape

A module SHALL organize its pipeline into the stage folders `scrape/` (fetching and archiving raw pages), `parse/` (turning raw pages into typed, validated records) and `ingest/` (writing records to the database). A module SHALL also have `pipeline.ts`, which runs the stages in order, and `index.ts`, its public surface. A module that is deployed SHALL have its Lambda entry point in `handler.ts`. Code that only one module uses SHALL live in that module, including its scripts and test fixtures.

#### Scenario: Sheriff-sale module folders

- **WHEN** `backend/src/modules/sheriffSale/` is listed
- **THEN** it contains `scrape/`, `parse/`, `ingest/`, `replay/`, `__fixtures__/`, `pipeline.ts`, `handler.ts`, `handler.local.ts` and `index.ts`

### Requirement: Stage imports run one way

Within a module, `scrape/` and `parse/` SHALL NOT import from `ingest/`, and no stage folder SHALL import from `pipeline.ts`, `handler.ts` or `replay/`. Types that cross from one stage to the next SHALL be defined in the earlier stage.

#### Scenario: Parsed page type

- **WHEN** the definition of `ParsedListingPage` is located
- **THEN** it is in `modules/sheriffSale/parse/`, and nothing under `parse/` imports from `ingest/`

#### Scenario: No import cycles between stages

- **WHEN** the imports of every file under `modules/sheriffSale/scrape/` and `modules/sheriffSale/parse/` are listed
- **THEN** none of them resolves into `modules/sheriffSale/ingest/`

### Requirement: A module's index is its only public surface

Code outside a module SHALL import from that module only through its `index.ts`. The index SHALL export only what code outside the module uses, and SHALL NOT re-export a module's stages as a grouped service object. `shared/` SHALL NOT import from any module.

#### Scenario: Shared code stays independent

- **WHEN** the imports of every file under `backend/src/shared/` are listed
- **THEN** none of them resolves into `backend/src/modules/`

#### Scenario: No deep imports from outside a module

- **WHEN** the imports of every file under `backend/src/` outside `modules/sheriffSale/` are listed
- **THEN** any import that resolves into `modules/sheriffSale/` resolves to `modules/sheriffSale/index.ts`

### Requirement: Canonical address shape

`shared/address` SHALL export an `Address` type with the fields `address`, `street`, `unit`, `secondaryUnit`, `city`, `state` and `zipcode`, and a `parseAddress` function that turns a free-text NJ address into an `Address`. Every module SHALL store a parsed address in this shape. `parseAddress` SHALL split and normalize an address the way `cleanAddress` did, and SHALL set `state` to `NJ`. `ADDRESS_SUFFIX` SHALL live in `shared/address`.

#### Scenario: Two-line address

- **WHEN** `parseAddress('8 Floyd Drive\nTotowa NJ 07512')` is called
- **THEN** it returns address `8 Floyd Drive Totowa NJ 07512`, street `8 Floyd Drive`, city `Totowa`, state `NJ`, zipcode `07512`, and empty `unit` and `secondaryUnit`

#### Scenario: Listing snapshots are unchanged

- **WHEN** a details page that was synced before this change is parsed into a snapshot again
- **THEN** the snapshot's listing fields and `contentHash` equal the ones the old code produced, so the sync reports it `unchanged`

