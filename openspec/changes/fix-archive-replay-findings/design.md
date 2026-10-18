## Context

A dry run of `replay:archive` from 2024-10-23 to 2026-10-18 read every archived county page and parsed every archived detail page through the same path as the daily scrape. Its counts and the pages behind them are in the proposal. Grouped by cause, the findings are:

| Cause                         | Where it is now                                        | Effect                                                                |
| ----------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| `Property Address` label      | `cleanPropertyKey` camel-cases it to `propertyAddress` | Every Middlesex and Cape May listing is rejected; the daily run fails |
| No upset row                  | `listingSchema` reads only an `upsetAmount` key        | NULL upset in 8 counties                                              |
| Upset with trailing text      | `toAmount` requires the whole value to be a number     | NULL upset, one warning                                               |
| Blank address                 | `address()` in `listingSchema` throws                  | Snapshot dropped                                                      |
| Only an all-fail county fails | `pipeline.ts` throws only when 0 listings parse        | 78% home pages never failed a run                                     |
| No alarms                     | `infra/scraper.tf`                                     | Two years of failures unnoticed                                       |
| Every listed key read         | `replayCountyDay`                                      | ~97% of ~890k S3 reads miss                                           |
| `max: 1` pool                 | `packages/database/src/client.ts`                      | Replay writes are serial                                              |

Where each county puts its upset amount, from the 2,387 detail pages archived on 2026-10-18:

| County                                                              | Upset row                                              | Amount found in                     |
| ------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| Atlantic, Bergen, Camden, Cumberland, Essex, Hudson, Passaic, Union | Yes (blank on some Atlantic, Cumberland, Hudson pages) | —                                   |
| Burlington, Gloucester, Monmouth, Morris, Salem                     | No                                                     | `Description`                       |
| Hunterdon                                                           | No                                                     | `Property Details`, `Property Note` |
| Middlesex                                                           | No                                                     | `Property Note`, `Description`      |
| Cape May                                                            | No                                                     | `Minimum Bid`, `Description`        |

Constraints: the Lambda's environment stays `DATABASE_URL` only (`scraper-infrastructure`); syncs must stay order-independent so the backfill can be re-run; the replay's dry run must never import `@sheriff-sale/database`.

## Goals / Non-Goals

**Goals:**

- Store every field the archive and the live site already publish, for every county.
- Make a partial scraper breakage fail the run, and make a failed run send an email.
- Make the full-range replay fast enough to run twice: once to verify, once into prod.
- Backfill prod once, after the parser fixes ship.

**Non-Goals:**

- Recovering the listings that were never archived. The site serves only current listings.
- Storing occupancy status, which several counties' free text carries.
- Parsing attorney phones that have notes after the number. They keep their raw text, as `listing-validation` already specifies.
- Accepting sale dates more than five years out. The one seen, 7/13/2034, is on a site test listing.

## Decisions

### Upset extraction runs in `validateListingDetails`, on the raw record

`parseListingDetails` and `parseLegacyListingDetails` already return every label's text, `propertyNote`, `propertyDetails` and `description` included, keyed by `cleanPropertyKey`. `validateListingDetails` sees that raw record before it drops unknown keys, so the fallback goes there: when the schema's `upsetAmount` is NULL, try `propertyDetails`, then `propertyNote`, then `description`, through a new `parse/extractUpsetAmount.ts`. Both layouts get it, and the replay and the daily scrape share it.

Alternative: extract in the two layout parsers. Rejected: it would be written twice, and the parsers deliberately leave coercion to `listingSchema`.

### The matcher looks for an upset phrase, then the next money-shaped figure

`extractUpsetAmount` finds the first of `upset`, `good faith estimate`, `estimated bid` or `bid amount` (case-insensitive), then takes the first figure within the next 200 characters that is money-shaped: `$` followed by digits, or digits with comma grouping, each optionally followed by two decimals. Plain numbers such as `2024` or `19` don't match, so dates and block and lot numbers are skipped. The figure goes through the same `toAmount` as the upset row.

This covers every variant in the dry-run log, including `UPSET RPIVE: $347,505.92` (the phrase is `upset`) and Hunterdon's `UPSET AMOUNT: … SATISFIED BY THIS SALE IS 1,668,737.41` (no `$`). A judgment-only sentence has no upset phrase, so it yields nothing.

Alternative: any dollar figure in the text. Rejected: legal notices in `Description` often state the judgment first.

### `Minimum Bid` maps to `upsetAmount` in `cleanPropertyKey`

Cape May publishes a minimum bid where other counties publish an upset price: the lowest bid the sheriff will accept. Treating it as the upset row also gives it precedence over Cape May's `Description`. `Property Address` maps to `address` alongside `Address`, by an exact-label check in `cleanPropertyKey`, the same way `Sales Date` maps to `saleDate`.

### A leading amount is kept, with a warning

`toAmount` parses an optional `$`, the digits and commas, and up to two decimals at the start of the trimmed value. When text follows, the field gets that amount and a warning with the full value, so the drift stays visible in the summary. It applies to `judgment` as well as `upsetAmount`, since both use `money()`.

### A missing address stores NULLs

The schema's `address()` becomes optional: empty or missing gives NULL and a warning. `parseAddress` takes `string | null`; for NULL it returns every `Address` field NULL except `state`, which stays `NJ`. `Address` fields become `string | null`. The listing's identity is `(county, sheriffId)`, so a NULL address doesn't affect matching, and a later snapshot with an address fills it in through the normal update.

The scraper still rejects a page with no sheriff number, which the unique index needs.

### A county fails below half parsed

`pipeline.ts` rejects when `parsed < found / 2` (with `found > 0`), and the error names the county with both counts. The parsed listings are still written first, so a partial failure loses no data. Half is a deliberately coarse line: the dry run's normal days parse 90%+ of what was archived, and the home-page days parsed under 25%.

Alternative: emit a parse-rate metric and alarm on it. Rejected for now: the handler already turns any county failure into a Lambda error, so one errors alarm covers it without a custom metric.

### The replay lists each day's keys once

A new `shared/s3/listS3Keys(bucket, prefix)` pages through `ListObjectsV2`. `replayArchive` calls it once per date, and `replayDetailPage` skips the read when the key isn't in that set, counting it missing as before. The replay already documents that its AWS profile needs `s3:ListBucket`. If the listing call fails, the date falls back to reading every listed key, so the change can't lose pages.

### Pool size from `DATABASE_POOL_MAX`

`packages/database/src/client.ts` reads `DATABASE_POOL_MAX`, defaulting to 1, and throws on anything but a positive integer. The replay's `index.ts` sets it to `DETAIL_PAGE_CONCURRENCY` (8) when unset, before its dynamic import of the database package. The Lambda never sets it, so it keeps one connection and its environment is unchanged.

### Alarms through one SNS email topic

`infra/scraper.tf` gains the SNS topic, its email subscription and three alarms (errors, DLQ depth, no invocations in a day); see `scraper-infrastructure`. `alert_email` is a new non-sensitive variable, which CI passes as `TF_VAR_alert_email` from a GitHub Actions repository variable. The errors and DLQ alarms overlap, since a failed run with no retries lands in the DLQ. The DLQ alarm also catches async invocations dropped without an `Errors` datapoint, such as throttles, and stays in `ALARM` until the queue is drained, which forces triage.

## Risks / Trade-offs

- [Upset phrase matches a figure that isn't the upset] → The tests cover every variant seen in the archive. After the full-range dry run, compare each extracted upset with `judgment` and sample 20 per county for review.
- [A NULL address breaks a reader] → `Listing.address` is already nullable. The frontend's `ListingTable` renders it as an empty cell; check `ListingDetails` and the map before shipping.
- [The half-parsed rule makes daily runs fail on noise] → The parsed listings are still written, and the email names the county and counts, so a false alarm costs a look, not data.
- [The SNS subscription is never confirmed] → Alarms change state but no email arrives. The migration plan includes confirming it and a test notification.
- [The backfill updates listings with older snapshots] → `syncListing` only applies a snapshot at least as new as the stored one, so a listing whose latest stored snapshot is 2026-10-18 keeps its fields, and only its status rows widen.

## Migration Plan

1. Merge. A push to `main` builds the bundle and applies `infra/`; the next 00:00 UTC run uses the new parser.
2. Confirm the SNS subscription email, then publish a test message to the topic.
3. Run the full-range dry run with the new replay and compare with the baseline: at least 6,515 parsed, Middlesex and Cape May parse failures at 0.
4. Run `replay:archive --from 2024-10-23 --to 2026-10-18` into prod with `DATABASE_URL` set from `PROD_DATABASE_URL`.
5. Verify in prod: Middlesex and Cape May have listings, and the null-upset share by county is down from its current values.

Rollback: revert the merge to restore the old parser and alarms. Rows the backfill wrote stay valid, since every field it set is one the old code would also write. Re-running the replay after any later parser fix is safe.

## Open Questions

- Which email address should `alert_email` be?
