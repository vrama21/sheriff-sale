## Context

The scraper Lambda (`backend/src/handlers/newJerseySheriffSaleScraperHandler.ts`) runs daily and calls `newJerseySheriffSaleCountyParser` for each of the 14 NJ counties in parallel. For each county the controller (`backend/src/controllers/newJerseySheriffSaleScraper.ts`):

1. fetches the county listings page and parses about 100 property IDs from it;
2. calls `Promise.all(propertyIds.map(...))` to fetch each listing's detail HTML, archive it to S3 (`getListingDetailsHtml.ts`), and parse it;
3. finds and inserts each new listing and its status histories (`Promise.allSettled`).

Step 2 is unbounded, so with all counties running at once about 1,300 HTTP requests and about 2,600 S3 calls start within seconds. CloudWatch shows `EMFILE`, `getaddrinfo EBUSY`, `TypeError ... reading 'replace'` (at `he.decode(response.data)`) and parse `TypeError`s. Any one of them rejects step 2, so step 3 never runs. That explains zero DB writes since November 2024.

Reading the code turned up three more contributors:

- `NewJerseySheriffSaleHttpClient` registers request and response interceptors whose error handlers are `(error) => error`. An axios error handler that _returns_ turns the rejection into a resolved value. The base `HttpClient` handler throws, but the subclass handler runs after it and swallows the throw. So a failed request resolves to an `AxiosError`, `response.data` is `undefined`, and `he.decode` throws the misleading `replace` `TypeError`.
- `saveHtmlToS3` checks whether the object exists with `GetObject` and never reads the body. In AWS SDK v3 an unread `GetObject` body keeps its socket checked out. `getS3` and `saveS3` also build a new `S3` client on every call. Together these add a large number of open sockets: the `EMFILE`.
- The handler catches each county's error, rethrows inside `Promise.allSettled`, ignores the results, and returns "ran successfully". Lambda never records an error, so async-invoke retries and the DLQ (`infra/scraper.tf`) never engage.

Constraints: Node 24 Lambda, 512 MB, 900 s timeout, default async retries (2) with an SQS DLQ. postgres.js runs with `max: 1` and connects lazily. No new runtime dependencies.

## Goals / Non-Goals

**Goals:**

- A normal run gets through every county and writes new listings to the DB.
- One bad listing can't block its county. A broken county can't block the others.
- Real failures surface as Lambda errors (retries, then the DLQ). Logs state clearly what failed and how many.
- DB connectivity problems surface at the start of the run, before any scraping.

**Non-Goals:**

- Moving `DATABASE_URL` to SSM, separating local runs from prod resources, and OpenTofu or infra changes.
- Updating listings that already exist or their status histories. The current insert-only behavior stays.
- Retrying individual listings within a run. The Lambda's async retry covers transient failures.
- Rewriting the HTML parsers, beyond making their failures per-listing.

## Decisions

### 1. One shared, in-repo concurrency limiter (8 in flight)

Add `backend/src/utils/createConcurrencyLimiter.ts`. `createConcurrencyLimiter(limit)` returns `limit(task)`: a function that runs `task` once fewer than `limit` tasks are active, and returns a promise for its result. The controller module creates a single instance (`LISTING_CONCURRENCY = 8`). All counties share it, so the cap holds across the whole run, not per county. Each listing's fetch, S3 archive and parse runs inside one limited task.

- _Why 8:_ about 1,300 listings × roughly 1 s each ÷ 8 ≈ 3 minutes, well under the 900 s timeout, and gentle on salesweb.civilview.com.
- _Alternatives:_ `p-limit` (ESM-only in recent versions, which complicates the CJS esbuild/ts-jest setup, and it's a dependency for about 20 lines); sequential counties with a limit per county (less total throughput for the same peak load); batching with `Promise.all` over chunks (one slow listing stalls each whole batch).
- The county listings pages (14 requests) stay unbounded. That load is trivial.

### 2. Per-listing failures are isolated; a county fails only when one of its stages fails completely

Every listing is processed through `Promise.allSettled`, so no rejection escapes. Each failure is logged with its `propertyId` and county. The county moves on to the DB stage with the listings that did parse. A county counts as **failed** (the controller throws) when:

- its listings page can't be fetched or parsed (as today), or
- it found at least one listing and **none** parsed, or
- it attempted at least one DB write and **every** write failed.

Otherwise it logs a summary (`found / parsed / failed / inserted / write failures`) and resolves. Partial losses are logged but don't fail the run.

- _Why "all items failed" rather than any:_ listings fail individually for reasons that never go away (odd HTML on one property). Failing on any one of them would send every run to the DLQ forever and hide real outages among the false alarms. "All failed" catches what actually caused this outage (site layout changes, blocking, DB down) without flapping.
- _Alternative:_ a failure-ratio threshold such as 50%. It adds a tunable without evidence for the right value. Easy to add later if the logs show we need it.

### 3. The handler throws when any county fails

The handler runs counties through `Promise.allSettled`, logs one summary line, and if any county rejected throws `Error("New Jersey Sheriff Sale Scraper failed for N/14 counties: A, B")`. The error message lists the failed counties, and each cause is logged.

- _Any versus all:_ this is the ambiguity the brief flagged. Under "all counties failed", one county silently broken for months looks like success, which is the same class of invisibility that caused this outage. Under "any county failed", a single bad county retries the whole run twice and then lands in the DLQ. Retries are idempotent: inserts skip listings already in the DB, and the S3 archive skips keys that already exist. So the cost is extra scraping, not bad data. Under Decision 2 a county fails only when a whole stage fails, so "any" doesn't flap on single listings. **Chosen: any.**

### 4. DB health check before scraping

The handler runs `` await sql`SELECT 1` `` (the postgres.js client exported by `@sheriff-sale/database`) before starting counties. If it fails, the handler logs `Database health check failed` with the cause and throws. Scraping without a working DB would only produce S3 files, and the retry and DLQ path should fire right away.

### 5. Fix the HTTP client error interceptors

Change `NewJerseySheriffSaleHttpClient`'s interceptor error handlers from `(error) => error` to rethrow, so failed requests reject with the real `AxiosError` (status, `ECONNRESET`, and so on). `getListingDetailsHtml` (and `getCountyListingsHtml`) also throw a descriptive error when `response.data` isn't a non-empty string. That guard covers a 200 response with an empty body.

### 6. Make the S3 archive best-effort and leak-free

- `getListingDetailsHtml` decodes once and returns the same `html` it archives.
- The S3 archive stays _before_ parsing, so HTML that fails to parse is still saved for debugging. A failed save is logged and doesn't fail the listing. The archive is a side record, and the DB is what matters.
- `saveHtmlToS3` checks for an existing object with `HeadObject` instead of `GetObject`, so no body is left unread. It treats only a not-found error (`NotFound` / 404) as "doesn't exist". Any other error propagates, and the caller logs it.
- `getS3`, `saveS3` and the new `s3ObjectExists` share one module-level `S3` client.
- The county listings page archive in `getCountyListingsHtml` becomes best-effort the same way, so a transient S3 error doesn't throw away a county's scrape.

### 7. Testability

To make the controller testable with `jest.mock`, split it into `scrapeListing(county, propertyId)` (fetch + parse), `saveListing(listing, statusHistory)` (DB write), and the orchestrating `newJerseySheriffSaleCountyParser`. Tests mock `../services/newJerseySheriffSale` and `@sheriff-sale/database`, whose client module throws at import when `DATABASE_URL` is unset. Nothing touches the network, S3 or a real DB.

## Risks / Trade-offs

- [The site rate-limits or blocks us even at 8 in flight] → Per-listing failures are now visible with counts. Lowering `LISTING_CONCURRENCY` is a one-line change.
- [Throwing on any county failure turns one persistently broken county into a daily DLQ message] → That's the intended signal. The error names the county. The other 13 counties still write their data on every attempt.
- [Async retries re-scrape every county, which costs about three times the runtime and traffic on a bad day] → Acceptable for a once-a-day job. Writes are idempotent.
- [Longer runs (minutes instead of seconds)] → Well under the 900 s timeout. If listing counts grow a lot, raise concurrency or the timeout.
- [The first successful run inserts every listing missing since October 2024 (≈ the current ~1,300 listings, minus ones already present)] → Expected backfill. The insert path is unchanged apart from isolation.

## Migration Plan

Deploy through the normal CI `deploy-backend` job (bundle → OpenTofu apply). No schema or infra changes. After the first scheduled run on the new Lambda (`/aws/lambda/new-jersey-sheriff-sale-scraper`), check the logs for `Parsed N listings` and `Inserted Listing` lines, and confirm the DLQ is empty. Rollback: redeploy the previous commit.

## Open Questions

- None blocking. The failure-ratio threshold (Decision 2) and the concurrency value (Decision 1) can be tuned once real run logs exist.
