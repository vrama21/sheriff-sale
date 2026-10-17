## Why

The backend is laid out by technical layer (`controllers/`, `services/`, `types/`, `utils/`), so the sheriff-sale pipeline is spread across four folders with no boundary around it. The next piece of work is a second pipeline that parses NJ parcel HTML, and the current layout has no place to put it that wouldn't tangle it with sheriff-sale code:

- **`services/newJerseySheriffSale` and `services/listingSync` import each other.** `listingSync/buildListingSnapshot` uses the scraper's `cleanAddress` and `listingSchema`, and `newJerseySheriffSale/parseListingSnapshot` uses `listingSync`'s `ParsedListingPage` type. They are one module split in two.
- **There's no public surface.** The `newJerseySheriffSaleService` barrel exposes twelve functions, internals like `parseLegacyListingDetails` among them, and callers skip it anyway: the controller deep-imports `saveHtmlToS3`, and `scripts/replayArchive` deep-imports five files under `src/services/`.
- **`types/` mixes global and pipeline-specific code.** `NJCounty` is used everywhere, `NJSheriffSaleCountyIdMap` is civilview's county IDs, and `ListingParse`, `StatusHistoryParse` and `BaseModel` aren't used at all.
- **Address parsing lives inside the scraper**, but every pipeline needs to store addresses in one unified shape, whatever the raw data looks like.

The restructure comes first, as its own change with no behaviour change, so the parcel work starts from clean boundaries and this diff stays a reviewable move.

## What Changes

- Reorganize `backend/src/` into `modules/sheriffSale/` and `shared/`:
  - `modules/sheriffSale/` holds the whole sheriff-sale pipeline in three stage folders: `scrape/` (civilview client, county IDs, HTML fetch, S3 archive), `parse/` (layout detection, current and legacy parsers, status history, `listingSchema`), and `ingest/` (snapshot build, normalization, content hash, `syncListing`). Beside them sit `pipeline.ts` (today's controller), `handler.ts` and `handler.local.ts` (the Lambda entry points), `replay/` (the archive replay, moved from `backend/scripts/replayArchive/`), `__fixtures__/`, and `index.ts`, its public surface.
  - `shared/` holds the code any module may use: `nj/` (`NJ_COUNTIES`, `NJCounty`), `address/`, `http/` (`HttpClient`), `s3/`, and `concurrency/` (`createConcurrencyLimiter`).
- Within the module, imports run one way, `scrape` and `parse` before `ingest`. `ParsedListingPage` moves into `parse/`, which breaks the `newJerseySheriffSale` ↔ `listingSync` cycle.
- Add `shared/address` with a canonical `Address` type (`address`, `street`, `unit`, `secondaryUnit`, `city`, `state`, `zipcode`). Move `cleanAddress` and `ADDRESS_SUFFIX` into it, and rename `cleanAddress` to `parseAddress`, which returns an `Address`. It now sets `state` to `NJ`, which `buildListingSnapshot` currently adds on its own. Every parsed field keeps its current value.
- Remove the `newJerseySheriffSaleService` grab-bag object. The pipeline imports its stages directly, and the module's `index.ts` exports only what code outside the module calls.
- The boundaries are a convention in this change and are checked by review and the verification greps. Lint enforcement is deferred until `migrate-lint-format-to-vite-plus` lands, because that change deletes `backend/.eslintrc.js` and moves linting to `vp lint`. The rules then go into the Vite+ config.
- **BREAKING (tooling)**: Delete `backend/scripts/backfillListingAddresses/`. Its migration (`0006_backfill_listing_addresses.sql`) has been applied, and the SQL file stays in the migration history. With `replayArchive` moved into the module, `backend/scripts/` is removed.
- Delete the unused `ListingParse`, `StatusHistoryParse` and `BaseModel` types, and the emptied `controllers/`, `services/`, `types/`, `utils/` and `handlers/` folders.
- Update the `bundle`, `start:newJerseyScraper`, `replay:archive` and `lint` scripts in `backend/package.json`, and the roots in `jest.config.js`, for the new paths. The bundle stays `backend/dist/index.js` exporting `handler`.

## Capabilities

### New Capabilities

- `backend-module-layout`: How the backend is organized into domain modules and shared code: the module folder shape and its stage folders, the one-way stage imports, a module's `index.ts` as its only public surface, `shared/` importing nothing from modules, and the canonical shared `Address` type.

### Modified Capabilities

- `infra-delivery`: "Lambda bundle build" bundles `src/modules/sheriffSale/handler.ts` instead of `src/handlers/newJerseySheriffSaleScraperHandler.ts`.
- `scraper-infrastructure`: "Scraper Lambda function" names the new handler path as the bundle's source.
- `listing-validation`: the "No unchecked casts" scenario searches `backend/src/modules/sheriffSale/` instead of the removed `services/newJerseySheriffSale/` and `controllers/` folders.
- `archive-replay`: the "Legacy page fields" scenario refers to `parseAddress` instead of `cleanAddress`.
- `listing-address-backfill`: every requirement is removed along with the backfill script.

## Impact

- Code: every file under `backend/src/` moves, and `backend/scripts/` is folded in or deleted. Tests move with their source files and keep their assertions; only import paths and the `cleanAddress` → `parseAddress` name change. No runtime behaviour changes: same scrape, same parse output, same DB writes, same S3 keys.
- Build: `backend/package.json` scripts and `jest.config.js` change. The Lambda bundle's output path, export and contents are unchanged, so `infra/` and `.github/workflows/cicd.yml` are untouched.
- Dependencies: none added.
- Database, frontend, `packages/*`: not changed.
- Overlap: `migrate-lint-format-to-vite-plus` (unmerged) also edits `backend/package.json`'s `lint` scripts and `backend/jest.config.js`. Whichever merges second rebases those lines.
- Out of scope: lint enforcement of the boundaries (follows the Vite+ migration), the parcel module, contracts between modules, a shared pipeline abstraction, splitting the address parser into a free-text splitter and a normalizer, and shared Drizzle address columns.
