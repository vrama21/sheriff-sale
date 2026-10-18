# backend

Sources for the New Jersey sheriff sale scraper, an AWS Lambda (`new-jersey-sheriff-sale-scraper`, Node.js 24) that
runs daily at 00:00 UTC. It scrapes each county's listings, stores the raw HTML in the `nj-sheriff-sale` S3 bucket, and
writes parsed sales to the database.

The handler is `src/modules/sheriffSale/handler.ts`. The Lambda and the rest of its AWS resources are defined in
[`../infra`](../infra/README.md).

`src/modules/<module>/` holds one domain pipeline each, in `scrape/`, `parse/` and `ingest/` stage folders, with its
`index.ts` as its only public surface. `src/shared/` holds code any module may use, and imports nothing from a module.

## Commands

| Command                          | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| `npm run build`                  | Type-check, then bundle the handler to `dist/index.js` |
| `npm run test`                   | Run the Jest tests                                     |
| `npm run lint`                   | Lint `src/`                                            |
| `npm run start:newJerseyScraper` | Run the scraper locally                                |

`start:newJerseyScraper` and `replay:archive` read `DATABASE_URL` from the repo-root `.env` (see the root README's
"Local database"). `start:newJerseyScraper` always writes to the same S3 bucket as the deployed Lambda, and to whichever
database `.env` points at, so with a prod `DATABASE_URL` a local run changes real data.

## Deploying

Pushes to `main` deploy the Lambda: CI builds the bundle and applies `infra/` with OpenTofu.
