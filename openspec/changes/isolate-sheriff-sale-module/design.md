## Context

`backend/src/` is organized by technical layer:

```
handlers/     Lambda entry + local runner
controllers/  newJerseySheriffSaleScraper (the county pipeline)
services/
  newJerseySheriffSale/  civilview client, fetch, archive, parsers, listingSchema, cleanAddress
  listingSync/           buildListingSnapshot, contentHash, normalize, syncListing
  constants/             ADDRESS_SUFFIX
  http/  s3/
types/        NJCounty, NJSheriffSaleCountyIdMap, ListingParse, StatusHistoryParse, BaseModel
utils/        createConcurrencyLimiter
backend/scripts/  replayArchive, backfillListingAddresses
```

Every one of those folders is either sheriff-sale code or generic infrastructure, but nothing says which. The two sheriff-sale service folders import each other (`listingSync` → `cleanAddress`, `listingSchema`; `newJerseySheriffSale` → `ParsedListingPage`), and the scripts deep-import files under `src/services/`. A second pipeline, NJ parcel HTML, is planned. How it will relate to sheriff sales (per-listing enrichment, an independent pipeline joined through the DB, or bulk ingest) isn't decided, so this change can't design cross-module contracts yet. It only draws the boundaries.

Constraints: no behaviour change (same scrape, parse output, DB writes and S3 keys); the Lambda bundle stays `backend/dist/index.js` exporting `handler`, so `infra/` and CI are untouched.

## Goals / Non-Goals

**Goals:**

- One folder per domain pipeline, with everything that pipeline alone uses inside it.
- Shared code at the top level, usable by any module and dependent on none.
- A module's `index.ts` as its only public surface (lint enforcement follows the Vite+ migration).
- One canonical `Address` shape every module stores, whatever its raw data.
- A pure move that the existing test suite verifies.

**Non-Goals:**

- The parcel module, or any stub of it.
- Contracts between modules (a `contracts/` folder, shared ports, a composition root).
- A shared pipeline abstraction (`Pipeline<Raw, Parsed, Record>`, base stage classes).
- Splitting `parseAddress` into a free-text splitter and a field normalizer.
- Shared Drizzle address columns, or any `packages/database` change.
- Renaming classes or functions beyond `cleanAddress` → `parseAddress` and the `parseCountyProperyIds` typo.

## Decisions

### Target layout

```
backend/src/
├── modules/sheriffSale/
│   ├── index.ts                     export { handler }
│   ├── handler.ts                   ← handlers/newJerseySheriffSaleScraperHandler.ts
│   ├── handler.local.ts             ← handlers/local/newJerseySheriffSaleScraperHandler.local.ts
│   ├── pipeline.ts (+ .test)        ← controllers/newJerseySheriffSaleScraper.ts
│   ├── scrape/
│   │   ├── newJerseySheriffSaleHttpClient.ts (+ .test)
│   │   ├── njSheriffSaleCountyIdMap.ts (+ .test)   ← types/
│   │   ├── countySlug.ts
│   │   ├── getCountyListingsHtml.ts
│   │   ├── getListingDetailsHtml.ts (+ .test)
│   │   └── saveHtmlToS3.ts (+ .test)
│   ├── parse/
│   │   ├── parseCountyPropertyIds.ts (+ .test)     ← parseCountyProperyIds.ts
│   │   ├── parseListingSnapshot.ts (+ .test)       + ParsedListingPage
│   │   ├── parseListingDetails.ts / parseLegacyListingDetails.ts (+ .test)
│   │   ├── parseStatusHistory.ts (+ .test)
│   │   ├── cleanPropertyKey.ts / detailValueText.ts
│   │   └── listingSchema.ts (+ .test)
│   ├── ingest/
│   │   ├── buildListingSnapshot.ts / contentHash.ts / normalize.ts / syncListing.ts (+ .test)
│   ├── replay/                      ← backend/scripts/replayArchive/*
│   └── __fixtures__/                ← services/newJerseySheriffSale/__fixtures__/
└── shared/
    ├── nj/njCounty.ts               ← types/njCounty.ts
    ├── address/parseAddress.ts (+ .test), addressSuffix.ts
    ├── http/httpClient.ts
    ├── s3/                          getS3, getS3Text, saveS3, s3Client
    └── concurrency/createConcurrencyLimiter.ts (+ .test)
```

Each `shared/*` folder keeps an `index.ts`, like today's `http/`, `s3/` and `utils/`. File names keep matching their main export, the repo's convention. `pipeline.ts` and `handler.ts` are the exceptions, because they're the module's fixed entry points.

Moves use `git mv` so history follows each file.

### Modules split by domain, with stage folders inside

The user's framing is that each pipeline is "scrape, parse, ingest", so those are the stage folders. Imports between stages run one way: `scrape` and `parse` never import `ingest`. That's what breaks the current cycle. `ParsedListingPage` is the output of parsing, so it moves to `parse/parseListingSnapshot.ts`, and `ingest/buildListingSnapshot` imports it from there. `listingSchema` goes in `parse/` because `parseStatusHistory` needs its `RawStatusRow`. `buildListingSnapshot` keeps calling the validators, now as an `ingest → parse` import, which points the allowed way.

*Alternative*: keep `listingSync` as its own module. Rejected: snapshots, the content hash, status normalization and the `(county, sheriffId)` identity only make sense for civilview listings.

### The handler lives in the module; no top-level `handlers/` or `contracts/`

Each module is its own deployable pipeline, so it owns its Lambda entry point. A top-level composition root and a `contracts/` folder earn their place once two modules have to talk, and that relationship is the open question this change defers. Adding them now would mean guessing at a contract with one data point.

`index.ts` exports only `handler`. Nothing outside the module imports anything else today. esbuild's entry point is a file path (`src/modules/sheriffSale/handler.ts`), not an import, and `handler.local.ts` and `replay/` sit inside the module.

### The `newJerseySheriffSaleService` object goes away

`pipeline.ts` imports each stage function directly. The object only existed to group the barrel, and it made internals public.

### Address: move whole, rename, add `state`

`cleanAddress` and `ADDRESS_SUFFIX` move to `shared/address`. The function is renamed `parseAddress`, and its return type becomes an exported `Address`: `{ address, street, unit, secondaryUnit, city, state, zipcode }`. It sets `state: 'NJ'`, so `buildListingSnapshot` stops adding `state` itself. The regexes and normalization are untouched.

`contentHash` hashes JSON with sorted keys, so moving where `state` is set doesn't change any hash: same keys, same values. Existing rows still compare `unchanged`.

*Alternative*: split it now into a free-text splitter and a field normalizer, since parcel data may arrive pre-split. Deferred until parcel's raw shape is known; the existing tests pin today's behaviour for whenever that split happens.

### The S3 archive helper stays in the module

`saveHtmlToS3`, `ARCHIVE_BUCKET_NAME` and `todaysArchiveDate` go to `sheriffSale/scrape/`. The `<prefix>/<YYYY-MM-DD>/<suffix>` key convention is generic, but the bucket is sheriff-specific, and parcel's archive needs are unknown. The generic half moves to `shared/` when a second module needs it. `getS3Text`, which only replay uses, stays in `shared/s3` with the rest of the S3 helpers.

### Boundary lint deferred until the Vite+ migration

The unmerged `migrate-lint-format-to-vite-plus` change deletes `backend/.eslintrc.js` and lints with `vp lint`, so ESLint rules added here would be thrown away. In this change the boundaries are checked by review and by the import greps in the verification tasks. A follow-up adds these rules to the Vite+ lint config:

| target | may not import | except |
|---|---|---|
| `src/shared/**` | `src/modules/**` | |
| `src/modules/<m>/{scrape,parse}/**` | `src/modules/<m>/ingest/**` | |
| anything outside `src/modules/<m>/` | `src/modules/<m>/**` | `src/modules/<m>/index.ts` |

The `lint` scripts lint `./src` only, since `./scripts` is gone.

*Alternative*: add `eslint-plugin-import`'s `no-restricted-paths` now. Rejected: the Vite+ migration would delete it. *Alternative*: TS project references or a workspace per module. Rejected as heavyweight for one module, and it would complicate the single esbuild bundle.

### Scripts fold in or go

`scripts/replayArchive/*` → `modules/sheriffSale/replay/`, with `replay:archive` pointing at `src/modules/sheriffSale/replay/index.ts`. `scripts/backfillListingAddresses/` is deleted: migration `0006` is applied, and the SQL file stays. `jest.config.js` roots become `['<rootDir>/src']`.

## Risks / Trade-offs

- [A test silently stops running after a move] → Record the test count from `npm test` in `backend` before starting, and require the same count with all passing at the end. Only the removed backfill tests (`plan.test.ts`, `output.test.ts`) may drop off, and the expected new count is stated in the PR.
- [The bundle changes behaviour, e.g. a dropped or duplicated module] → After the move, check that `node -e "require('./backend/dist/index.js').handler"` is a function, and diff the bundle's list of bundled module names against the pre-move bundle to catch a dropped or added dependency.
- [Content hashes shift and every listing rewrites on the next run] → `buildListingSnapshot.test` keeps its exact expected snapshot, and a test asserts `contentHash` for a fixture page equals the value from before the move.
- [Without lint, a deep import slips back in before the rules land] → The verification greps check every boundary rule, and the follow-up lint change proves each rule fails on a deliberately bad import.
- [Merge conflict with `migrate-lint-format-to-vite-plus` on `backend/package.json` lint scripts and `jest.config.js`] → Small, line-level; whichever merges second rebases.
- [Archiving a delta that removes every requirement leaves an empty `listing-address-backfill` spec] → At archive time, delete `openspec/specs/listing-address-backfill/` if the archive leaves it empty.
- [The layout is designed around one module, and parcel may not fit `scrape/parse/ingest`] → It's a convention, not an abstraction. A module can add or drop a stage folder; the import rules, not the folder names, are what the boundary checks enforce.

## Migration Plan

One PR, merged to `main` like any backend change. CI builds the bundle from the new entry path, and `deploy-backend`/OpenTofu updates the Lambda code by bundle hash. No database migration, no infra change. Rollback is reverting the merge commit.

## Open Questions

- Whether Vite+'s linter (oxlint) can express path-zone rules like `no-restricted-paths`, or whether the follow-up needs `no-restricted-imports` patterns or a small custom check.

- How the parcel module relates to sheriff sales, and so what the first cross-module contract looks like. Deferred to the parcel change.
- Whether parcel's raw addresses are free text or pre-split. That decides when `parseAddress` gets split.
