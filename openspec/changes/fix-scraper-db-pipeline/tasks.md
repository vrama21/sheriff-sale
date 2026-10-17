## 1. Concurrency limiter

- [x] 1.1 Add `backend/src/utils/createConcurrencyLimiter.ts`: `createConcurrencyLimiter(limit)` returns `limit(task)`, which runs at most `limit` tasks at once and passes each task's result or rejection through. Export it from `backend/src/utils/index.ts`.
- [x] 1.2 Add `createConcurrencyLimiter.test.ts`. Cover: never more than `limit` tasks active at once, every task runs, results come back in input order under `Promise.all`, and a rejection propagates without stalling the queue.

## 2. HTTP client and listing HTML fetch

- [x] 2.1 In `NewJerseySheriffSaleHttpClient`, change the request and response interceptor error handlers from `(error) => error` to rethrow, so failed requests reject.
- [x] 2.2 In `getListingDetailsHtml`, throw a descriptive error naming the `propertyId` when `response.data` isn't a non-empty string. Decode once and return that same `html`. Make the S3 archive best-effort: catch and log save errors, keep archiving before parse.
- [x] 2.3 Apply the same empty-body guard to `getCountyListingsHtml`, naming the county, and make its S3 archive best-effort too.
- [x] 2.4 Add `getListingDetailsHtml.test.ts`, with the HTTP client stubbed through an in-process axios adapter and `saveHtmlToS3` mocked. Cover: decoded HTML is archived and returned, a 503 rejects with the HTTP error (fails against the old `(error) => error` interceptors), an empty body rejects naming the property, and a failed S3 save is logged without failing the fetch.
- [x] 2.5 Set `timeout: 30_000` in `NewJerseySheriffSaleHttpClient`'s axios config. Add a case to `getListingDetailsHtml.test.ts`: an adapter that rejects with `ECONNABORTED` makes the fetch reject with that timeout error.

## 3. S3 archive

- [x] 3.1 Add a shared module-level `S3` client (`backend/src/services/s3/s3Client.ts`), and use it from `getS3` and `saveS3`.
- [x] 3.2 Remove the existence check from `saveHtmlToS3`, so it always calls `saveS3`. Delete `s3ObjectExists.ts` and its export from `backend/src/services/s3/index.ts`. The Lambda role has no `s3:ListBucket`, so `HeadObject` on a missing key returns 403, not 404 (design Decision 6). Add `saveHtmlToS3.test.ts` with `../s3` mocked: it asserts one `saveS3` call with the dated key and no read from the bucket.

## 4. Controller: isolation and county failure rule

- [x] 4.1 Split `newJerseySheriffSaleScraper.ts` into `scrapeListing(county, propertyId)` (fetch + parse) and `saveListing(listing, statusHistory)` (find, then insert listing and status histories, returning whether it inserted).
- [x] 4.2 Run every listing's `scrapeListing` through one module-level limiter (`LISTING_CONCURRENCY = 8`) shared across counties, using `Promise.allSettled`. Log each failure with its `propertyId` and county.
- [x] 4.3 Run the DB stage over the listings that parsed, with `Promise.allSettled`, and log each write failure.
- [x] 4.4 Apply the county failure rule: throw when listings were found but none parsed, or when writes were attempted and all failed. Otherwise log a summary of found / parsed / failed / inserted / write failures.
- [x] 4.5 Add `newJerseySheriffSaleScraper.test.ts`, with `../services/newJerseySheriffSale` and `@sheriff-sale/database` mocked. Cover: one bad listing still saves the rest, all listings failing rejects, all writes failing rejects, zero listings resolves, and in-flight listing tasks never exceed 8 across two counties running in parallel.
- [x] 4.6 Wrap each new listing's insert and its status-history inserts in one `db.transaction`, so a failed history insert rolls back the listing and a retry redoes the whole listing. Add a controller test: a failing history insert fails that listing's write, and every insert goes through the transaction.

## 5. Handler: health check and failure reporting

- [x] 5.1 Add the DB health check (`` sql`SELECT 1` ``) at the start of the handler. On failure, log `Database health check failed` with the cause and throw before scraping.
- [x] 5.2 Run counties with `Promise.allSettled`, log each rejected county's cause and a run summary, and throw an error naming the failed counties when any county failed. Return the success message only when all succeeded.
- [x] 5.3 Add `newJerseySheriffSaleScraperHandler.test.ts` (controller and `@sheriff-sale/database` mocked). Cover: all succeed returns success; one county fails throws naming it while the others still run; a failed health check throws without calling the controller.

## 6. Verification

- [x] 6.1 In `backend/`, run `npm run build`, `npm test` and `npm run lint` and fix any failures. Don't run the scraper locally (it writes to the prod bucket and DB) and don't invoke the Lambda.
- [x] 6.2 Run `openspec validate fix-scraper-db-pipeline --strict` and fix any issues.
