## 1. Fixtures and baseline

- [ ] 1.1 Copy detail pages from `s3://nj-sheriff-sale/listing-html-files/2026-10-18/` into `modules/sheriffSale/__fixtures__/` for Middlesex (`Property Address`, upset in `Property Note`), Cape May (`Minimum Bid`), Burlington and Gloucester (upset in `Description`) and Hunterdon (`Property Details`), plus the blank-address Hunterdon page `listing-html-files/2025-10-26/property-id-1736127112.html`
- [ ] 1.2 Keep the dry run's summary from 2026-10-18 as the baseline for 7.1: 6,515 parsed, 23,944 unrecognised, 229 failed to parse, 858,967 detail pages missing

## 2. Parser: labels and money

- [ ] 2.1 In `parse/cleanPropertyKey.ts`, map `Property Address` to `address` and `Minimum Bid` to `upsetAmount`; add `cleanPropertyKey` and `parseListingDetails` tests with the Middlesex and Cape May fixtures
- [ ] 2.2 In `parse/listingSchema.ts`, make `toAmount` take a leading amount followed by text and warn with the full value; add the "Amount followed by text" and "No leading amount" scenarios to `listingSchema.test.ts`, keeping the existing money scenarios passing
- [ ] 2.3 Update the comment in `listingSchema.ts` that keeps its rules in step with `drizzle/0007_normalize_listing_values.sql`, to say the leading-amount rule is parser-only; leave the applied migration unchanged

## 3. Parser: upset fallback and missing address

- [ ] 3.1 Add `parse/extractUpsetAmount.ts`: the first money-shaped figure within 200 characters after `upset`, `good faith estimate`, `estimated bid` or `bid amount`; unit tests for every variant in the spec and the dry-run log (`UPSET RPIVE`, Hunterdon's no-`$` figure, a judgment-only sentence, blank text)
- [ ] 3.2 In `validateListingDetails`, when `upsetAmount` is NULL, fill it from `propertyDetails`, then `propertyNote`, then `description`; add `propertyDetails` to `IGNORED_KEYS`; test with the Hunterdon, Burlington, Gloucester and Middlesex fixtures, and that an upset row wins over free text
- [ ] 3.3 Make the schema's `address` optional (NULL plus a warning when missing or blank), make `Address` fields `string | null`, and have `parseAddress(null)` return NULL fields with `state: 'NJ'`; update `buildListingSnapshot` and its tests
- [ ] 3.4 Test the blank-address fixture: the snapshot builds with a NULL address, sheriff number `F-4127`, and one `address` warning
- [ ] 3.5 Check that `ListingTable`, `ListingDetails` and `ListingMap` in `frontend/` render a NULL address without errors
- [x] 3.6 Add `attorneyFile` to `IGNORED_KEYS`: the full-range dry run's 225 `attorneyFile` warnings are all blank values
- [x] 3.7 When the upset row has text that money coercion rejects, run `extractUpsetAmount` on the row before the free text, keeping its warning; test with the Hudson fixtures `listingDetailsHudsonUpsetText.html` (2025-03-29 `property-id-1535606338`, 224000) and `listingDetailsHudsonUpsetNotNeeded.html` (2026-10-18 `property-id-2196805809`, NULL)

## 4. Pipeline failure threshold

- [ ] 4.1 In `pipeline.ts`, reject a county when `parsed < found / 2`, after writing the parsed listings, with an error naming the county and both counts
- [ ] 4.2 Add `pipeline.test.ts` cases for 100 found / 22 parsed (rejects, 22 written), 10 / 5 (resolves) and the existing all-fail and all-writes-fail cases

## 5. Replay speed

- [ ] 5.1 Add `shared/s3/listS3Keys(bucket, prefix)`, paging through `ListObjectsV2`, with a test against a stubbed client
- [ ] 5.2 In `replay/replay.ts`, list `listing-html-files/<date>/` once per date and skip reads for keys not in it, counting them missing; on a listing error, log it, count a failed read and fall back to reading every listed key; add `replay.test.ts` cases for both
- [ ] 5.3 In `packages/database/src/client.ts`, size the pool from `DATABASE_POOL_MAX` (default 1, throw on a non-positive-integer value naming the variable)
- [ ] 5.4 In `replay/index.ts`, set `DATABASE_POOL_MAX` to `DETAIL_PAGE_CONCURRENCY` when unset, before the dynamic import of `@sheriff-sale/database`; update the usage comment and `backend/README.md`

## 6. Alarms

- [ ] 6.1 Add the `alert_email` variable to `infra/variables.tf`, and `TF_VAR_alert_email: ${{ vars.ALERT_EMAIL }}` to the apply job in `.github/workflows/cicd.yml`
- [ ] 6.2 In `infra/scraper.tf`, add the SNS topic `new-jersey-sheriff-sale-scraper-alarms` with an email subscription, and the errors, DLQ and no-runs alarms per `scraper-infrastructure`
- [ ] 6.3 Run `tofu fmt -check -recursive` and `tofu validate` in `infra/`, and document the alarms and `ALERT_EMAIL` in `infra/README.md`

## 7. Verify and ship

- [ ] 7.1 Run `npm test`, `npm run lint` and `npm run build` in `backend`, then a full-range dry run (`AWS_PROFILE=sheriff-sale npm run replay:archive -- --from 2024-10-23 --to 2026-10-18 --dry-run`) and compare with 1.2: parsed at least 6,515, 0 Middlesex and Cape May parse failures, and a run time in minutes
- [ ] 7.2 From the dry run, compare each free-text upset with its `judgment` and review 20 extracted upsets per county
- [ ] 7.3 Set the `ALERT_EMAIL` repository variable, merge, confirm the SNS subscription email, and publish a test message to the topic
- [ ] 7.4 After the next 00:00 UTC run, check its logs: Middlesex and Cape May parse, and the run succeeds

## 8. Backfill prod

- [ ] 8.1 Run `DATABASE_URL="$(mise exec -- printenv PROD_DATABASE_URL)" AWS_PROFILE=sheriff-sale npm run replay:archive -- --from 2024-10-23 --to 2026-10-18` in `backend`, and save the summary
- [ ] 8.2 Verify in prod: Middlesex and Cape May have listings, and the null-`upsetAmount` share by county is down from 141/141 Hunterdon and 459/459 Gloucester
- [ ] 8.3 Re-run the same replay and confirm it reports 0 inserted, 0 updated, 0 status rows inserted and 0 extended
