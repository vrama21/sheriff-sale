## 1. Baseline

- [x] 1.1 Run `npm test` in `backend` and record the passing test count, and the counts in `scripts/backfillListingAddresses/*.test.ts`, for the PR description
- [x] 1.2 Run `npm run build` in `backend`, and save the list of module paths in `dist/index.js` (esbuild's `// path` comments) as the pre-move bundle baseline
- [x] 1.3 Record `contentHash` for the snapshot built from `__fixtures__/listingDetailsPassaic.html` (and one legacy fixture), to pin in a test in 4.4

## 2. Shared code

- [x] 2.1 `git mv` `services/http/` → `shared/http/`, `services/s3/` → `shared/s3/`, `utils/createConcurrencyLimiter.ts` (+ test, index) → `shared/concurrency/`, and `types/njCounty.ts` → `shared/nj/njCounty.ts` with an `index.ts`
- [x] 2.2 `git mv` `services/newJerseySheriffSale/cleanAddress.ts` (+ test) → `shared/address/parseAddress.ts` and `services/constants/addressSuffix.ts` → `shared/address/addressSuffix.ts`; add `shared/address/index.ts`
- [x] 2.3 Rename `cleanAddress` to `parseAddress`, export an `Address` type (`address`, `street`, `unit`, `secondaryUnit`, `city`, `state`, `zipcode`) as its return type, and set `state: 'NJ'` in its result; update its tests for the name and the `state` field, leaving every other expectation unchanged
- [x] 2.4 Confirm nothing under `shared/` imports anything outside `shared/` other than packages

## 3. Sheriff-sale module: scrape and parse

- [x] 3.1 `git mv` the civilview client, `countySlug`, `getCountyListingsHtml`, `getListingDetailsHtml`, `saveHtmlToS3` (+ tests) and `types/njSheriffSaleCountyIdMap.ts` (+ test) into `modules/sheriffSale/scrape/`
- [x] 3.2 `git mv` the parsers, `cleanPropertyKey`, `detailValueText` and `listingSchema` (+ tests) into `modules/sheriffSale/parse/`; rename `parseCountyProperyIds` to `parseCountyPropertyIds` (file, export, test, callers)
- [x] 3.3 Move the `ParsedListingPage` type from `listingSync/buildListingSnapshot.ts` into `parse/parseListingSnapshot.ts`
- [x] 3.4 `git mv` `services/newJerseySheriffSale/__fixtures__/` → `modules/sheriffSale/__fixtures__/`, and update `stubClientAdapter`'s client import and every fixture path
- [x] 3.5 Fix imports under `scrape/` and `parse/` to the new `shared/*` and sibling paths; confirm none of them imports `ingest/`

## 4. Sheriff-sale module: ingest, pipeline and entry points

- [x] 4.1 `git mv` `services/listingSync/*` (+ tests) → `modules/sheriffSale/ingest/`; import `ParsedListingPage`, `listingSchema` and `parseAddress` from their new homes, and drop `state: 'NJ'` from `buildListingSnapshot` now that `parseAddress` sets it
- [x] 4.2 `git mv` `controllers/newJerseySheriffSaleScraper.ts` (+ test) → `modules/sheriffSale/pipeline.ts`, and replace its `newJerseySheriffSaleService.*` calls with direct imports of the stage functions
- [x] 4.3 `git mv` the handler → `modules/sheriffSale/handler.ts` and the local runner → `modules/sheriffSale/handler.local.ts`, and move `handlers/newJerseySheriffSaleScraperHandler.test.ts` beside it
- [x] 4.4 Add a test pinning the `contentHash` values recorded in 1.3, so a moved `state` or changed field can't shift them silently
- [x] 4.5 Write `modules/sheriffSale/index.ts` exporting only `handler`; delete `services/newJerseySheriffSale/index.ts`, `services/listingSync/index.ts` and `controllers/index.ts`

## 5. Scripts

- [x] 5.1 `git mv` `scripts/replayArchive/*` → `modules/sheriffSale/replay/` and fix its imports, including `readFixture` from `../__fixtures__/stubClientAdapter`
- [x] 5.2 Delete `scripts/backfillListingAddresses/` and the now-empty `backend/scripts/`; keep `packages/database/drizzle/0006_backfill_listing_addresses.sql`

## 6. Cleanup and config

- [x] 6.1 Delete `types/listingParse.ts`, `types/statusHistoryParse.ts`, `types/baseModel.ts` and `types/index.ts`; move `types/environment.d.ts` to `src/environment.d.ts` (or `shared/`) and confirm it's still picked up by `tsc`
- [x] 6.2 Confirm `controllers/`, `services/`, `types/`, `utils/` and `handlers/` are gone and `backend/src/` holds only `modules/`, `shared/` and any ambient `.d.ts`
- [x] 6.3 Update `backend/package.json`: `bundle` entry → `src/modules/sheriffSale/handler.ts`, `start:newJerseyScraper` → `src/modules/sheriffSale/handler.local.ts`, `replay:archive` → `src/modules/sheriffSale/replay/index.ts`, `lint`/`lint:fix` → `./src` only
- [x] 6.4 Set `jest.config.js` roots to `['<rootDir>/src']`

## 7. Boundary check (lint deferred to the Vite+ migration)

- [x] 7.1 Grep every import under `backend/src/shared/` and confirm none resolves into `modules/`
- [x] 7.2 Grep every import under `modules/sheriffSale/scrape/` and `parse/` and confirm none resolves into `ingest/`
- [x] 7.3 Grep every import outside `modules/sheriffSale/` and confirm any that resolves into it targets `modules/sheriffSale/index.ts` (or the module folder itself)

## 8. Verify

- [x] 8.1 `npm test` in `backend` passes with the baseline count minus only the deleted backfill tests, plus the new hash test
- [x] 8.2 `npm run build` and `npm run lint` pass in `backend`; `npm run build`, `npm test` and `npm run lint` pass at the repo root
- [x] 8.3 `require('./backend/dist/index.js').handler` is a function, and the bundle's module list matches the baseline apart from the moved paths
- [x] 8.4 `npm run replay:archive -- --help` (or with a bad county) runs from the new path and prints usage/the error, without reading S3
- [x] 8.5 Grep `backend/` and `openspec/specs/` (outside archived changes) for stale references: `services/newJerseySheriffSale`, `services/listingSync`, `controllers/`, `src/handlers/`, `scripts/replayArchive`, `cleanAddress`, `parseCountyProperyIds`, `newJerseySheriffSaleService`; update the backend README if it mentions any
