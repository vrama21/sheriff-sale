## Why

Prod saved no new listings from 2024-10-23 until the 2026-10-18 run. A dry run of `replay:archive` over that range showed why, and showed how little the archive can recover: of 889,655 detail pages the county pages listed, 858,967 were never archived, and 23,944 of the 30,688 that were are the site's home page. Only 6,515 parse into snapshots. #19 fixed the session problem behind that going forward, but nothing alerted on two years of failed runs, and the dry run surfaced parser gaps that still drop data on every daily run:

- **Middlesex and Cape May fail completely.** Their pages label the address `Property Address`, which `cleanPropertyKey` maps to `propertyAddress`, so every listing is rejected for having no address. Prod has no listings in either county, and the scheduled run fails every day because of it.
- **Eight counties never store an upset amount.** Burlington, Cape May, Gloucester, Hunterdon, Middlesex, Monmouth, Morris and Salem have no upset row; the amount is in free text (`Description`, `Property Note`, `Property Details`) or, in Cape May, `Minimum Bid`. Prod has a null `upsetAmount` on all 141 Hunterdon and all 459 Gloucester listings.
- **Recoverable values are thrown away.** An upset amount with text after it (`$384,211.73 GOOD THROUGH JULY 19, 2024, …`) becomes NULL, and a page with a blank Address row is dropped whole, though its sheriff number and amounts are good.
- **The replay is too slow to iterate on.** It requests every listed detail page, so ~97% of its ~890k S3 reads miss, and the database client's single connection serializes every write.

Fixing these before the one-time prod backfill means the backfill stores everything the archive holds, and the daily run stops failing.

## What Changes

- Map the `Property Address` label to `address`, and Cape May's `Minimum Bid` to `upsetAmount`.
- When a page has no upset row, take the upset amount from the dollar figure that follows an upset or bid phrase in `Description`, `Property Note` or `Property Details`, never from a judgment figure. `Property Details` stops producing an unknown-field warning.
- Money coercion takes a leading dollar amount followed by text, instead of setting the field to NULL.
- **BREAKING (stored data)**: A listing with a missing or blank address is stored with a NULL address instead of being rejected. A missing sheriff number still rejects it.
- A county fails the run when fewer than half of its listed properties parse, not only when all of them fail, so a partial breakage like the home-page responses fails the run.
- The replay lists each day's archived detail pages once and reads only keys that exist. It runs its database writes over a configurable pool, set by `DATABASE_POOL_MAX`; the Lambda keeps a single connection.
- Add CloudWatch alarms on scraper errors, messages in the dead-letter queue, and a day with no invocation, notifying an SNS email topic.
- After deploy, replay 2024-10-23 through 2026-10-18 into prod once.

The two years of listings that were never archived can't be recovered: the site only serves current listings. The attorney phone kept as raw text when notes follow it, and the out-of-range 2034 sale date on a site test listing, stay as they are.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `civilview-scraping`: "Listing details parsing" maps `Property Address` to `address` and `Minimum Bid` to `upsetAmount`, and reads `Property Details` instead of dropping it.
- `listing-validation`: "Only a missing address rejects a listing" is replaced by a listing without an address being stored. "Money coercion" accepts a leading amount followed by text. A new requirement takes the upset amount from free text when the page has no upset row.
- `scraper-pipeline`: a county fails when fewer than half its listings parse.
- `archive-replay`: "County pages select the detail pages" reads only archived keys from a per-day listing. A new requirement sets the replay's database pool size.
- `scraper-infrastructure`: new requirements for the scraper alarms and their SNS topic.

## Impact

- `backend/src/modules/sheriffSale/parse/` (`cleanPropertyKey.ts`, `listingSchema.ts`, new upset extraction) and `ingest/buildListingSnapshot.ts`; `shared/address/parseAddress.ts` accepts a null address.
- `backend/src/modules/sheriffSale/pipeline.ts` (county failure threshold) and `replay/` (per-day key listing, pool size).
- `packages/database/src/client.ts` reads `DATABASE_POOL_MAX`, default 1.
- `infra/scraper.tf` and `infra/variables.tf`: alarms, SNS topic and an `alert_email` variable. The Lambda's environment is unchanged.
- New fixtures from the 2026-10-18 archive for Middlesex, Cape May, Burlington, Gloucester and Hunterdon.
- Prod data: the backfill inserts and updates listings from the archive. Listings already stored get their upset amounts, and Middlesex and Cape May get listings. The frontend must show a listing whose address is NULL.
