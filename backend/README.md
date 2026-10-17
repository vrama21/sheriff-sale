# backend

Sources for the New Jersey sheriff sale scraper, an AWS Lambda (`new-jersey-sheriff-sale-scraper`, Node.js 24) that
runs daily at 00:00 UTC. It scrapes each county's listings, stores the raw HTML in the `nj-sheriff-sale` S3 bucket, and
writes parsed sales to the database.

The handler is `src/handlers/newJerseySheriffSaleScraperHandler.ts`. The Lambda and the rest of its AWS resources are
defined in [`../infra`](../infra/README.md).

## Commands

| Command                          | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| `npm run build`                  | Type-check, then bundle the handler to `dist/index.js` |
| `npm run test`                   | Run the Jest tests                                     |
| `npm run lint`                   | Lint `src/`                                            |
| `npm run start:newJerseyScraper` | Run the scraper locally                                |

`start:newJerseyScraper` writes to the same S3 bucket and database as the deployed Lambda, so local runs change real
data.

## Deploying

Pushes to `main` deploy the Lambda: CI builds the bundle and applies `infra/` with OpenTofu.
