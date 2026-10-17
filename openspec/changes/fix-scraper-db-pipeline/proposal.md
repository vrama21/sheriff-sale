## Why

The daily scraper hasn't written to the database since October 2024. The Lambda's CloudWatch logs show `Found N listings` on every run, but zero `Parsed N listings` and zero `Inserting Listing` lines since November 2024. Each county fires one HTTP fetch and one S3 round trip per listing, all at once. That is about 1,300 of each across 14 counties, which exhausts sockets and DNS (`EMFILE`, `getaddrinfo EBUSY`). A single failed listing rejects the county's `Promise.all`, so the DB stage never runs. The handler wraps everything in `Promise.allSettled` and always reports success, so nothing reached the DLQ and the outage went unnoticed for two years.

## What Changes

- Bound listing-detail work (HTTP fetch + S3 archive) with one concurrency limiter shared across all counties, so the scraper never has more than a fixed number of listings in flight.
- Isolate per-listing failures: a listing that fails to fetch or parse is logged and skipped, and the county goes on to the DB stage with the listings that did parse.
- Fix the HTTP client so failed requests reject instead of resolving to an error object. The subclass's `(error) => error` interceptors currently make `response.data` undefined and cause the `he.decode` `TypeError`. Also guard against an empty response body.
- Make archiving to S3 best-effort, and stop leaking sockets: use `HeadObject` for the existence check instead of an unconsumed `GetObject`, reuse one S3 client, and decode the listing HTML once.
- **BREAKING (operational)**: the handler throws when any county fails, so Lambda async retries and the DLQ engage. A county fails when its listings page can't be fetched or parsed, or when every listing it found fails to parse, or when every DB write it attempted fails.
- Run a DB health check (`SELECT 1`) at the start of each run. If it fails, the run aborts with a clear error before any scraping.
- Add unit tests for the limiter, the per-listing isolation, the county-failure rule, and the handler's error reporting.

## Capabilities

### New Capabilities

- `scraper-pipeline`: How a scraper run processes counties and listings end to end. Covers bounded concurrency, isolating per-listing failures, the DB health check, the rule for when a county counts as failed, and how the handler reports run failures.

### Modified Capabilities

<!-- None: no existing spec covers the scraper (only node-toolchain exists). -->

## Impact

- Code: `backend/src/handlers/newJerseySheriffSaleScraperHandler.ts`, `backend/src/controllers/newJerseySheriffSaleScraper.ts`, `backend/src/services/newJerseySheriffSale/getListingDetailsHtml.ts`, `.../newJerseySheriffSaleHttpClient.ts`, `.../saveHtmlToS3.ts`, `backend/src/services/s3/`, a new small concurrency utility, and new tests.
- Dependencies: none added. The limiter is a few lines of in-repo code.
- Operations: failed runs now show up as Lambda errors, which trigger up to two async retries and then the SQS DLQ. Retries are safe because inserts skip listings already in the DB. A run takes longer, since about 1,300 listings at a fixed concurrency need minutes rather than seconds, but it stays well under the 900s timeout.
- Out of scope: moving `DATABASE_URL` to SSM, isolating local runs from prod, and any OpenTofu changes.
