## Why

The scraper's parse step checks nothing at runtime. `parseListingDetails` builds its result with `{} as ListingParse`, `cleanPropertyKey` logs unknown keys but still copies them onto the listing, and the controller casts `listingDetails.address as string`. So whatever text the site returns is stored verbatim. A read-only profile of prod on 2026-10-17 (7,071 listings, 8,253 status-history rows) showed what that produces:

- **Money is text.** `upsetAmount` and `judgment` are `text` holding values like `"\r $1,585.95                    "`: about 55% have a `\r ` prefix and trailing spaces. There are also 437 whitespace-only and 240 empty `upsetAmount` values. The frontend's `formatToCurrency` runs `parseInt` on these strings, so it shows `$NaN` for `"$1,585.95"` and `$1.00` for `"1,585.95"`. Every non-empty value has the form `$D,DDD.DD`, so the conversion is lossless.
- **Dates are text.** `saleDate` and `StatusHistory.date` are `M/D/YYYY` or `MM/DD/YYYY`. 309 values also carry ` 02:00 PM`, and that's the only time ever seen. 133 `saleDate`s are empty, and 2 Hunterdon listings (and their status rows) say year 3021. Because they're text, they don't sort, and the same day can appear as two different strings.
- **Free text is dirty.** About 5,226 `plaintiff`/`attorney`/`defendant` values, 4,123 `description`s, 2,034 `attorneyPhone`s and 579 `priors` have `\r` or untrimmed whitespace. `attorneyPhone` comes in at least 9 shapes (`973-575-0707`, `(973) 575-0707`, `1(973)575-0707`, `973-575-0707 (NJ)`, …).
- **`$0.00` appears on 136 listings**, always as the listing's only amount. The site publishes it, so it's stored as `0`, not NULL.

## What Changes

- **New:** a hand-written Zod 4 schema in `backend` validates and coerces every scraped listing and status-history row before it's saved. The policy is flexible: only a missing `address` rejects a listing. Any other field that fails coercion becomes NULL (or keeps its trimmed raw value, for `attorneyPhone`) and logs a warning naming the field, value and `propertyId`. Status-history rows that fail are skipped with a warning.
- **Coercion rules:**
  - Money: `"$1,234.56"` → `1234.56`, `"$0.00"` → `0`, empty → NULL.
  - Dates: `M/D/YYYY[ hh:mm AM|PM]` → a date. The time is dropped. A year outside 2000 to (current year + 5) becomes NULL.
  - Text: strip `\r`, trim, and store `""` as NULL. `address` also collapses inner whitespace to single spaces.
  - `attorneyPhone`: normalized to `(973) 575-0707`, or `(973) 575-0707 x1234` when there's an extension. Anything else keeps its trimmed raw value and logs a warning.
  - Unknown keys: dropped, with a warning.
- **New:** the county summary log gains a `fieldWarnings` count, alongside `failedListings` and `failedWrites`.
- **BREAKING (schema):**
  - `Listing.upsetAmount` and `Listing.judgment` → `numeric(12,2)`, read as JS `number` (`mode: 'number'`).
  - `Listing.saleDate` and `StatusHistory.date` → `date`, read as `'YYYY-MM-DD'` strings (`mode: 'string'`).
  - `Listing.saleDate`, `plaintiff` and `sheriffId` lose prod's Prisma-era NOT NULL. Drizzle already types them as nullable, and 133 rows are empty in each.
- **Data migration:** existing rows are converted with the same rules, applied in SQL: text cleanup and phone normalization first, then the type changes with `USING` casts. Two status-history rows dated year 3021 are deleted, matching the parser's skip rule.
- **Frontend:**
  - Currency and sale dates are formatted from the typed values.
  - Amount checks use `!= null` instead of truthiness, so `0` renders as `$0.00` instead of a literal `0`.
  - `ListingTable` maps `upsetAmount`/`judgment` into its rows. Today it drops them, so the amount column always shows `-`.

## Capabilities

### New Capabilities

- `listing-validation`: How scraped listing fields and status-history rows are validated and coerced before storage: the reject/null/warn policy, the per-field coercion rules, and how warnings are reported.

### Modified Capabilities

- `listing-storage`: "Columns fit the site's values" changes. `upsetAmount` and `judgment` stop being unbounded text and become exact decimals, and `saleDate` and `StatusHistory.date` become dates. This capability is introduced by `listing-schema-fixes`, which is complete but not yet archived. **Archive `listing-schema-fixes` before this change** so that the delta applies.

## Impact

- Depends on `upgrade-drizzle`, for `numeric({ mode: 'number' })`, which requires drizzle-orm ≥ 0.41.
- Code:
  - New dependency `zod@4.x` in `backend`. The frontend stays on Zod 3.23 for tRPC; the two don't share schemas.
  - `backend/src/services/newJerseySheriffSale/`: `parseListingDetails`, `parseStatusHistory`, `cleanPropertyKey`, and a new schema module.
  - `backend/src/controllers/newJerseySheriffSaleScraper.ts`, `backend/src/types/`.
  - `packages/database/src/schema/listing.ts` and `statusHistory.ts`, plus two new migrations.
  - `frontend/src/helpers/formatToCurrency.ts`, `ListingDetails.tsx`, `ListingTable.tsx`.
- Database (prod):
  - Four column type changes and three DROP NOT NULLs.
  - Text cleanup across about 5,000 rows.
  - 2 status-history rows deleted.
  - About 2,700 `upsetAmount`, about 4,100 `judgment` and 133 `saleDate` values become NULL (all of them already empty), plus 2 `saleDate`s with year 3021.
- API: the tRPC `listing.list` output changes from `upsetAmount`/`judgment: string | null` to `number | null`. `saleDate` stays a string but is now always `YYYY-MM-DD` or `null`.
- Out of scope:
  - The 173 prod listings whose `address` is empty. `address` stays NOT NULL and they stay `''`.
  - Populating the `saleDates` filter dropdown, which is always `[]` today.
  - Updating listings that are already stored (writes stay insert-only).
  - drizzle-zod.
