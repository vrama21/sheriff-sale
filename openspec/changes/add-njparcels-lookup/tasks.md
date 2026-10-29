## 1. Spike: condo qualifiers (design D7)

- [ ] 1.1 From prod, pick an upcoming listing whose `extractParcel` result has a qualifier (`C0001`-style). By hand, with at most a handful of requests 5 s apart, find how njparcels addresses the unit: try `/property/<code>/<block>/<lot>/<qual>`, the lot's page, and `/api/v1.0/property/<code>_<block>_<lot>_<qual>.json`. Record the working URL and PIN forms and what the JSON `qual` field holds
- [ ] 1.2 Capture fixtures into `modules/njParcels/__fixtures__/`: Newark `0714/2001/1` (no zone), Washington Twp `0336/10.01/1` (zone `PP`), one condo unit page, and the `303` response headers for an unknown lot
- [ ] 1.3 Write the findings into `design.md` (D4's `pamsPin` suffix, D7, and the lookup URL in the njparcels-lookup spec) before starting group 4

## 2. County lists and municipality map

- [ ] 2.1 Rewrite `shared/nj/njCounty.ts` as `NJ_COUNTY_CODES` (all 21, alphabetical, with 2-digit codes), plus `NJCounty` and `NJ_COUNTIES` derived from it. Test Ocean → `15` and the count of 21
- [ ] 2.2 Add `SHERIFF_SALE_COUNTIES` and `SheriffSaleCounty` to `modules/sheriffSale/scrape/njSheriffSaleCountyIdMap.ts`, and retype the map as `Record<SheriffSaleCounty, string>`. Switch `handler.ts`, `handler.test.ts`, `replay/args.ts`, its test and the county-map test to the 17-county list. Add a test that no county maps to `12` (Sussex, DE)
- [ ] 2.3 Confirm `npm run build` and the backend tests pass with no other change. Every remaining `NJCounty` use (clerk records, `Listing.county`, snapshots) accepts all 21
- [ ] 2.4 Write `shared/nj/scripts/snapshotMunicipalities.ts`: fetch the njparcels home page once, parse the `<h3>` county headings and `/property/<code>/` anchors, derive `kind` and `baseName`, and write `shared/nj/njMunicipalities.ts`. Exit non-zero without writing when fewer than 21 counties parse. Add an npm script for it
- [ ] 2.5 Run the script, commit the generated map, and add the shape test: 21 counties, 564 entries, unique codes, each prefixed by its county's code, `0717` City Of Orange Twp, Princeton `1114`, no `1109`/`1110`

## 3. Municipality resolution and parcel fields

- [ ] 3.1 Move `extractParcel.ts` and its test from `modules/clerkRecords/parse/` to `shared/nj/`. Update clerk-records imports and export the functions from `shared/nj/index.ts`. The existing tests pass unchanged
- [ ] 3.2 Add `shared/nj/postalPlaceAliases.ts`, seeded from the dry run's unresolved cities (Williamstown, Franklinville, Sewell, Turnersville, Clarksboro, Browns Mills, Marlton, Mt. Laurel, Colonia, Parlin, Fords, Whitehouse Station, Morganville, Mays Landing, Cape May Court House, Villas, Rio Grande, Lake Hiawatha, Pompton Plains, Long Valley, Landing, Atco, Parsippany, Lake Hopatcong…). Check each one against a map or the municipality's own site before adding it. Leave out places that span municipalities (Sicklerville, Lake Hopatcong if it does)
- [ ] 3.3 Implement `shared/nj/resolveMunicipality.ts` (notice text, then city and its parenthetical, then alias, with exact base-name matching and kind disambiguation). Test every scenario in the nj-geography spec
- [ ] 3.4 Add `municipalityCode`, `block`, `lot`, `qualifier` and `pamsPin` to `packages/database/src/schema/listing.ts` with an index on `pamsPin`. Run `npm run db:generate`, check that the SQL only adds nullable columns and the index, and commit the migration
- [ ] 3.5 In `buildListingSnapshot`, derive the five fields (PIN format from the spike) and add them to `SnapshotListing` and `SNAPSHOT_FIELDS`. Extend the snapshot and sync tests with the listing-parcel scenarios and the "Resolver change reaches a scraped listing" scenario
- [ ] 3.6 Write `modules/sheriffSale/ingest/backfillListingParcels.ts` and the `backfill:parcels` npm script. Recompute all rows, write only those that differ in batches, leave `contentHash`, `snapshotDate` and `updatedAt` alone, and print the per-county summary and the top unresolved cities. Test it against the local database
- [ ] 3.7 Run the backfill on a local copy of prod data. Compare with the dry run (about 77% of upcoming listings with a PIN, 88% with a municipality). Add aliases for any big misses and re-run

## 4. njParcels module

- [ ] 4.1 Add `NjParcel` and the `NjParcelLookupStatus` enum to the database schema (`packages/database/src/schema/njParcel.ts`, exported from `schema/index.ts`), with a unique `pamsPin`. Generate and commit the migration
- [ ] 4.2 Create `backend/src/modules/njParcels/` with `scrape/`, `parse/`, `ingest/`, `__fixtures__/`, `pipeline.ts`, `handler.ts`, `handler.local.ts` and `index.ts`, plus a `start:njParcels` script
- [ ] 4.3 Implement `scrape/njParcelsClient.ts`:
  - one request in flight, at least 5 s from the end of each response to the next request;
  - no redirect following;
  - the delay doubles after a 429 or 5xx;
  - the run stops after 3 consecutive failures.

  Test it with fake timers and the stub adapter

- [ ] 4.4 Implement `parse/parsePropertyPage.ts`: the identity-sentence check, the property table, the zone sentence, the `<noscript>` money and date values, deed book/page and taxes. Test it against every fixture, including the Newark values in the spec
- [ ] 4.5 Implement `scrape/savePropertyPageToS3.ts` (best-effort, `njparcels/<code>/<YYYY-MM-DD>/<pin>.html`) and `ingest/syncNjParcel.ts` (status and `checkedAt` on every write, parsed fields only on `found`, `firstFoundAt` set once). Test the error-after-found and re-check scenarios against the local database
- [ ] 4.6 Implement candidate selection in `ingest/` (distinct due PINs of upcoming listings, never-checked first, then oldest) and `pipeline.ts` (30 s time budget, summary counts including zone coverage). Test selection with the re-check scenarios
- [ ] 4.7 Implement `handler.ts`: log and return the summary; throw only when lookups were attempted and none came back `found` or `not_found`. Test both outcomes
- [ ] 4.8 Run `start:njParcels` locally against about 10 real PINs. Check the stored rows against the live pages, and record the zone coverage in the PR

## 5. Build and infrastructure

- [ ] 5.1 Add the `njParcels` bundle to the backend `bundle` script (`dist/njParcels/index.js`). Confirm `backend/dist/index.js` contains no njParcels code
- [ ] 5.2 Add `infra/njParcels.tf`, mirroring `infra/clerkRecords.tf`: function `new-jersey-parcels`, log group, EventBridge rule `cron(0 4 * * ? *)` and its invoke permission, the shared role and DLQ, and 0 retries. Confirm `tofu plan` shows only additions
- [ ] 5.3 Update `infra/README.md` and the CI workflow if they list the bundles or functions

## 6. Rollout

- [ ] 6.1 Archive `add-clerk-records-press` before archiving this change (the `infra-delivery` delta builds on its text)
- [ ] 6.2 After the first deploy (groups 2–3), run `backfill:parcels` against prod and record its summary in the PR
- [ ] 6.3 After the module deploys, invoke `new-jersey-parcels` once by hand, check the summary and a sample of `NjParcel` rows, then leave it on its schedule
- [ ] 6.4 Record the terms-of-use decision (design Open Questions) before any frontend work uses `NjParcel`
