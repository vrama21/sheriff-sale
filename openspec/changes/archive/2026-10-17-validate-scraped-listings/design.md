## Context

The pipeline today, per listing (`scrapeListing` in `backend/src/controllers/newJerseySheriffSaleScraper.ts`):

```
HTML ─▶ parseListingDetails ─▶ `{} as ListingParse` (whatever keys cleanPropertyKey produced)
     ─▶ parseStatusHistory  ─▶ { status, date }[] read by childNodes position
     ─▶ cleanAddress(listingDetails.address as string)
     ─▶ { ...details, ...cleanedAddress, county, propertyId, state } ─▶ saveListing
```

No field is checked. `parseListingDetails` does `.replace('\n', ' ')`, which replaces only the first newline, and it never trims. That's where the `\r ` prefixes in prod come from. Values are the page's `innerText`.

Prod state (read-only profile, 2026-10-17). The schema is Prisma-era: every column is `text`. `address`, `plaintiff`, `saleDate`, `sheriffId`, `StatusHistory.date` and `StatusHistory.status` are NOT NULL, but Drizzle declares them all nullable, so drizzle-kit will never emit DROP NOT NULL for them. Migrations `0004`–`0006` are applied. `0006` already trimmed `address` and `saleDate`.

| Field | Shape in prod |
|---|---|
| `upsetAmount` / `judgment` | `$D,DDD.DD`, about 55% with `\r ` prefix and trailing spaces. `upsetAmount`: 1,979 NULL, 437 `\r`-only, 240 `''`. `judgment`: 4,090 NULL. `$0.00`: 118 / 24. |
| `saleDate` | `M/D/YYYY` 6,871, `MM/DD/YYYY 02:00 PM` 67, `''` 133, year 3021 ×2. No month > 12. |
| `StatusHistory.date` | `M/D/YYYY` 8,011, with ` 02:00 PM` 242, year 3021 ×2. |
| `attorneyPhone` | 2,034 dirty. Shapes: `999-999-9999` 1,592, `(999) 999-9999` 484, `999 999-9999` 290, `(999)999-9999` 45, `… (NJ)` 39, `1(999)…` 56, `(999)-999-9999` 14, about 20 with EXT/FAX/names. |
| `plaintiff`/`attorney`/`defendant` | about 5,226 with `\r`/untrimmed. 133 empty `plaintiff`. |
| `description` | 4,123 dirty, 2,229 with inner newlines. |

**`.env` at the repo root points at prod.** `drizzle.config.ts`, `client.ts` and `migrate.ts` load it. CI's `migrate` job runs `db:generate` then `db:migrate` on `main`.

## Goals / Non-Goals

**Goals:**
- One hand-written Zod 4 schema is the single source of the scraped listing's runtime check and TypeScript type.
- A flexible policy: one bad field never drops a listing. Only a missing address does.
- Money and dates are stored as real types, and existing rows are converted losslessly.
- Field-level problems are visible in the run summary.

**Non-Goals:**
- drizzle-zod or schemas generated from the table. The scraped data and the database row are different shapes.
- Sharing schemas with the frontend. The frontend stays on Zod 3.23 for tRPC.
- Fixing the 173 empty-address listings already in prod, populating the `saleDates` dropdown, or updating stored listings.

## Decisions

### 1. Parse to raw strings, validate in one place

`parseListingDetails` returns `Record<string, string>`: the `cleanPropertyKey`ed keys mapped to raw `innerText`, with no `as ListingParse`. `parseStatusHistory` returns `{ status: string; date: string }[]`. A new module, `services/newJerseySheriffSale/listingSchema.ts`, owns the Zod schemas and exports:

```ts
validateListingDetails(raw: Record<string, string>): { details: ScrapedListingDetails; warnings: FieldWarning[] }
validateStatusHistory(rows: RawStatusRow[]): { rows: StatusHistoryParse[]; warnings: FieldWarning[] }
type FieldWarning = { field: string; value: string; reason: string }
```

`validateListingDetails` throws when `address` is missing or blank. That's the only fatal case, and `scrapeListing` lets it propagate, so the existing `Promise.allSettled` counts it as a failed listing. `scrapeListing` attaches `propertyId` and county to warnings and returns them. `parseCountyListings` logs each warning and sums them into `fieldWarnings`.

*Alternative: `.strict()` everywhere and reject on any failure.* The user chose flexible: site drift on one field shouldn't drop listings.

### 2. Field helpers built from Zod 4 primitives, with warnings via `.catch(ctx => …)`

Each helper is a small schema factory that takes a per-call warning sink, so warnings are collected without global state:

```
text()        z.string() → strip \r, trim, '' → null
address()     text() + collapse /\s+/ → ' ', required (no catch: missing → throw)
money()       text() → null | strip [$,\s] → /^\d+(\.\d{1,2})?$/ → Number      .catch → null + warn
usDate()      text() → null | /^(\d{1,2})\/(\d{1,2})\/(\d{4})(\s.*)?$/ → luxon DateTime.fromObject,
              isValid && 2000 ≤ year ≤ now.year + 5 → 'YYYY-MM-DD'               .catch → null + warn
phone()       text() → null | PHONE_RE → '(AAA) BBB-CCCC[ xN]' | raw + warn (not null)
```

`PHONE_RE` (case-insensitive) is `^1?\s*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*\(NJ\))?(?:\s*(?:EXT\.?|X)\s*(\d{1,6}))?$`.

The object schema uses Zod 4's default `z.object` behavior, which strips unknown keys. Unknown keys are warned about before parsing, by diffing `Object.keys(raw)` against the schema's shape. `cleanPropertyKey` stops `console.error`ing, because the schema now owns that warning. Empty and whitespace-only money or dates become null **without** a warning. That case is the site publishing nothing, not drift.

`z.coerce.number()` is not used: `Number('$1,234.56')` is `NaN`.

*Alternative: hand-rolled validation functions.* That loses `z.infer` as the single type source, and the user asked for a Pydantic-like library.

### 3. Types come from the schemas

`ScrapedListingDetails = z.infer<typeof listingDetailsSchema>`. `ListingParse` stays `Omit<Listing, …>` from the Drizzle types, and the controller builds it from the validated details plus `cleanAddress`, county, `propertyId` and state. The validated output must be assignable to it without casts, so the Zod output types are chosen to match the new Drizzle column types: `number | null`, and `string | null` for ISO dates.

### 4. Column types

| Column | Drizzle | Read as |
|---|---|---|
| `upsetAmount`, `judgment` | `numeric(name, { precision: 12, scale: 2, mode: 'number' })` | `number \| null` |
| `saleDate`, `StatusHistory.date` | `date(name, { mode: 'string' })` | `'YYYY-MM-DD' \| null` |

The dates use `mode: 'string'`, not `'date'`. A JS `Date` at UTC midnight shifts a day when rendered in US time zones, and tRPC (no superjson) would serialize it to an ISO timestamp anyway.

`numeric(12,2)` holds values up to $9,999,999,999.99. The largest seen is $1,007,691.69. `mode: 'number'` reads through `parseFloat`, which is exact for display at this scale.

*Alternative: integer cents.* That would also work, but `upgrade-drizzle` makes `numeric` read as a number, and dollars stay legible in SQL.

### 5. Migrations: custom data migration, then the generated schema migration with hand-added `USING`

Following the `listing-schema-fixes` precedent (`0004` custom, then `0005` generated and hand-edited):

**`0007_normalize_listing_values` (custom, `drizzle-kit generate --custom`):**
1. `ALTER TABLE "Listing" ALTER COLUMN "saleDate" / "plaintiff" / "sheriffId" DROP NOT NULL`. This is Prisma drift that Drizzle can't see.
2. Normalize text in every scraped free-text column plus `upsetAmount`, `judgment`, `saleDate` and `StatusHistory.status`: `nullif(btrim(replace(col, E'\r', ''), E' \t\n'), '')`. Leave `address` alone: `0006` trimmed it, and it stays NOT NULL.
3. `attorneyPhone`: apply `PHONE_RE` with `regexp_match(…, 'i')` and rebuild the formatted string where it matches. Otherwise keep the trimmed text.
4. `saleDate`: set to NULL where it doesn't match the date regex, isn't a real date, or its year falls outside 2000 to `extract(year from now()) + 5`.
5. `DELETE FROM "StatusHistory"` for rows whose `date` fails the same rule (expected: 2 rows).

**`0008_<generated>` (schema, from `npm run db:generate` after the Drizzle schema edit):** drizzle-kit emits `SET DATA TYPE numeric(12,2)` / `date` without `USING`, and Postgres refuses to cast `text` to these types implicitly. Hand-add:
- money: `USING regexp_replace(col, '[$,]', '', 'g')::numeric(12,2)`
- dates: `USING to_date(split_part(col, ' ', 1), 'MM/DD/YYYY')`

`0007` has already made every remaining value castable. The migrations must be generated in this order (custom first) so the journal orders them correctly.

**Keep the SQL rules and the TS rules in step.** The phone and date regexes appear in both TS and SQL. A unit test table in `listingSchema.test.ts` holds the profile's real shapes. `inspect_listing_values.sql`, which is read-only and outside the journal, previews what `0007` would change, so the user can run it against prod before merging.

### 6. Frontend

- `formatToCurrency(value: number)`: drop the `parseInt` string branch.
- New `formatSaleDate('YYYY-MM-DD')` → `M/D/YYYY`, by string split (no `Date`, so no timezone shift). `null` → `-`.
- `ListingDetails.tsx`: `listing.upsetAmount != null` / `listing.judgment != null`, and the formatted sale date.
- `ListingTable.tsx`: the row mapping adds `upsetAmount` and `judgment`. The cell uses `rowData.judgment ?? rowData.upsetAmount` and `value != null`. The sale-date column uses `formatSaleDate`.

## Risks / Trade-offs

- [The generated `0008` lacks `USING`, so CI's migrate fails on `main`] → The task requires hand-editing it, and there's a check that the committed SQL contains `USING` for all four columns.
- [CI's `db:generate` emits an extra migration after merge] → Task: re-run `db:generate` after committing, and confirm it reports no changes.
- [SQL and TS phone/date rules drift apart] → The shared test table, plus the inspect SQL the user can diff against the TS output on sample rows.
- [A `USING` cast meets a value that `0007` didn't normalize, so the migration aborts] → Migrations run in a transaction, so nothing is half-applied. The inspect SQL counts uncastable values up front, and it should report 0.
- [Deleting status-history rows] → Only rows dated year 3021 (2 expected), matching the parser's skip rule. The inspect SQL lists them.
- [The tRPC output type change breaks frontend consumers] → The frontend type-check is a required gate.
- [Agents connect to prod through `.env`] → Never run `db:migrate`/`db:push`/`db:pull`/`db:studio`. Run drizzle-kit with `DATABASE_URL=postgres://localhost/unused`. Don't run the inspect SQL; the user does that.

## Migration Plan

1. Merge `upgrade-drizzle` first, and rebase this branch onto it.
2. Before merging, the user runs `inspect_listing_values.sql` read-only against prod and checks the counts: about 2 status rows deleted, 0 uncastable money or date values, and the phone normalization sample.
3. Merge to `main`. CI's `migrate` applies `0007` then `0008` before `deploy-backend` and `deploy-frontend`, so the new Lambda and frontend only ever see the typed columns.
4. Rollback: the type changes are reversible (`numeric`/`date` → `text`), but the text cleanup and the 2 deleted rows aren't. That's acceptable: the cleaned values are strictly more correct.

## Implementation Notes

This design was written against the parser from before `adapt-scraper-to-civilview` (#19). The implementation reconciles it with the current code as follows:

- **Parser output.** `parseListingDetails` keeps #19's text extraction: each value is trimmed with its whitespace collapsed, and only `address` keeps its `<br>` line break. It is not raw `innerText`, and there was no `.replace('\n', ' ')` left to remove. Only the `as unknown as ListingParse` cast goes.
- **Address line break.** `address()` strips `\r`, collapses whitespace within each line and trims, but keeps the line break, because `cleanAddress` splits street from city on it. The stored `address` is still on one line, since `cleanAddress` returns the fully collapsed form and the controller spreads it over the details.
- **Unknown keys.** `cleanPropertyKey` now maps every label to a camelCase key, and the schema decides which keys are known. `propertyNote` is on every page, so it is dropped without a warning (`IGNORED_KEYS`). Otherwise `fieldWarnings` would equal `parsed` on every run. Any other unknown key is dropped with a warning.
- **Warnings.** The helpers record warnings inside a `.transform` that calls the per-call sink, rather than via `.catch`. The behaviour is the same, and the trimmed value is reported.
- **`0007`.** Prod's `StatusHistory.status` and `date` are NOT NULL, so they are trimmed but not nulled. Rows with an empty status or an invalid date are deleted, matching the parser's skip rule. `0007` also nulls any `upsetAmount` or `judgment` that doesn't match the money rule (expected 0), so the `0008` cast can't abort. `0008`'s casts strip `[$,\s]` and take the date with `substring(… FROM '^[0-9/]+')`.

## Open Questions

- None blocking. The 173 empty-address listings are deferred to a later change.
