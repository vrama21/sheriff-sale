# backend

Sources for the New Jersey sheriff sale scraper, an AWS Lambda (`new-jersey-sheriff-sale-scraper`, Node.js 24) that
runs daily at 00:00 UTC. It scrapes each county's listings, stores the raw HTML in the `nj-sheriff-sale` S3 bucket, and
writes parsed sales to the database.

The handler is `src/modules/sheriffSale/handler.ts`. The Lambda and the rest of its AWS resources are defined in
[`../infra`](../infra/README.md).

`src/modules/<module>/` holds one domain pipeline each, in `scrape/`, `parse/` and `ingest/` stage folders, with its
`index.ts` as its only public surface. `src/shared/` holds code any module may use, and imports nothing from a module.

## Commands

| Command                                          | Description                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run build`                                  | Type-check, then bundle the handlers to `dist/index.js` and `dist/clerkRecords/index.js` |
| `npm run test`                                   | Run the Jest tests                                                                       |
| `npm run lint`                                   | Lint `src/`                                                                              |
| `npm run start:newJerseyScraper`                 | Run the scraper locally                                                                  |
| `npm run replay:archive`                         | Replay archived pages into the database (see below)                                      |
| `npm run start:clerkRecords -- [County] [limit]` | Run the clerk records lookups locally                                                    |

`start:newJerseyScraper` and `replay:archive` read `DATABASE_URL` from the repo-root `.env` (see the root README's
"Local database"). `start:newJerseyScraper` always writes to the same S3 bucket as the deployed Lambda, and to whichever
database `.env` points at, so with a prod `DATABASE_URL` a local run changes real data.

`start:clerkRecords` sends real requests to the county clerk portals (one at a time per portal, at least 1.5 s apart)
and writes to the `DATABASE_URL` database. It saves result pages under `CLERK_RECORDS_ARCHIVE_DIR` (default
`<tmpdir>/clerk-records`), never to S3. `src/modules/clerkRecords/ingest/ingest.db.test.ts` runs the ingest SQL against
a migrated database only when `CLERK_RECORDS_TEST_DATABASE_URL` names one.

## Replaying the archive

```sh
AWS_PROFILE=sheriff-sale npm run replay:archive -- [--county <name>]... --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--dry-run]
```

Parses the archived pages for each day in the range through the same path as the daily scrape, and syncs them.
Re-running a range writes nothing new. The AWS profile needs `s3:GetObject` and `s3:ListBucket` on `nj-sheriff-sale`:
each day's detail pages are listed once, and only archived ones are read. `--dry-run` reads and parses only, and never
connects to the database.

A real run opens `DATABASE_POOL_MAX` database connections, default 8 (one per detail page in flight), so its syncs run
in parallel. The Lambda leaves `DATABASE_POOL_MAX` unset and keeps one connection. The replay loads
`@sheriff-sale/database` from its build, so run `npm run build` at the root after changing that package.

## Deploying

Pushes to `main` deploy the Lambda: CI builds the bundle and applies `infra/` with OpenTofu.
