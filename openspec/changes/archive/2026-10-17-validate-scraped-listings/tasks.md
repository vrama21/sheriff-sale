## 0. Prerequisites

**Never run `db:migrate`, `db:push`, `db:pull` or `db:studio`, the inspect SQL, or anything else that connects to a database.** The repo's `.env` points at prod. Run drizzle-kit with `DATABASE_URL=postgres://localhost/unused` set in the command.

- [x] 0.1 Confirm this branch has `drizzle-orm` ≥ 0.41 (from `upgrade-drizzle`). If it doesn't yet, do groups 1–2 and 5 first, and rebase onto the `upgrade-drizzle` branch before starting groups 3–4.

## 1. Zod schema

- [x] 1.1 Add `zod` 4.x to `backend/package.json` dependencies, pinned exactly to the newest 4.x release that is at least two weeks old. Run `npm install` at the root, and confirm the frontend still resolves its own `zod@3.23.8`.
- [x] 1.2 Create `backend/src/services/newJerseySheriffSale/listingSchema.ts` per design Decisions 1–2: the field helpers (`text`, `address`, `money`, `usDate`, `phone`) with a per-call warning sink, `validateListingDetails` (throws on missing or blank address, warns about unknown keys) and `validateStatusHistory` (skips and warns about invalid rows), plus the `FieldWarning` type.
- [x] 1.3 Add `listingSchema.test.ts` with a table of the prod shapes from design Context: every money shape, including the `\r` prefix, `$0.00`, whitespace-only and `TBD`; dates with and without ` 02:00 PM`, `''`, `4/30/3021` and `2/30/2024`; all the phone shapes, including the extension and the unparseable `EXT … / FAX …` case; a missing address; an unknown key; and a mixed status-history list. Cover every scenario in `specs/listing-validation/spec.md`.

## 2. Parser and controller

- [x] 2.1 `parseListingDetails` returns `Record<string, string>` of raw `innerText` keyed by `cleanPropertyKey`. Remove `{} as ListingParse` and the `.replace('\n', ' ')`. In `cleanPropertyKey`, drop the `console.error` for unknown keys, since the schema warns about them now. Update `parseListingDetails.test.ts`: it now asserts the raw value, and the whitespace-collapsing assertion moves to the schema tests.
- [x] 2.2 `parseStatusHistory` returns raw `{ status, date }` strings.
- [x] 2.3 In `scrapeListing`, validate the details and the status history, pass the validated `address` to `cleanAddress` (no `as string`), and return the warnings with `propertyId` attached. In `parseCountyListings`, log each warning with the county, `propertyId`, field and value, and add `fieldWarnings` to `CountyParseSummary` and to the summary log line.
- [x] 2.4 Update the controller and handler tests: a missing address counts in `failedListings`, warnings are summed into `fieldWarnings`, and a listing with a coerced-to-null field is still saved.

## 3. Drizzle schema and migrations

- [x] 3.1 Generate the custom migration first (`npx drizzle-kit generate --custom --name normalize_listing_values` in `packages/database`) and write its SQL per design Decision 5 (steps 1–5).
- [x] 3.2 In `schema/listing.ts`, set `upsetAmount` and `judgment` to `numeric(..., { precision: 12, scale: 2, mode: 'number' })` and `saleDate` to `date(..., { mode: 'string' })`. In `schema/statusHistory.ts`, set `date` to `date('date', { mode: 'string' })`.
- [x] 3.3 Run `npm run db:generate` for the schema migration. Confirm that it orders after `0007` in `_journal.json` and contains only the four type changes, then hand-add the `USING` casts from design Decision 5. Grep the committed SQL to confirm all four `ALTER … SET DATA TYPE` statements have a `USING`.
- [x] 3.4 Add `packages/database/drizzle/inspect_listing_values.sql` (outside the journal, read-only `SELECT`s only). It should count the rows `0007` changes per column, the status-history rows it deletes (listed with `propertyId`), and the values the `0008` casts couldn't convert (expected 0), and it should show a 20-row before/after sample of the phone normalization. Don't run it.
- [x] 3.5 Run `npm run db:generate` again and confirm it reports no changes.

## 4. Frontend

- [x] 4.1 `formatToCurrency(value: number)`: remove the string branch. Add `formatSaleDate` (`'YYYY-MM-DD'` → `M/D/YYYY` by string split; `null` → `-`) to `frontend/src/helpers` and export it.
- [x] 4.2 `ListingDetails.tsx`: use `!= null` checks for `judgment`/`upsetAmount` and `formatSaleDate` for the sale date.
- [x] 4.3 `ListingTable.tsx`: map `upsetAmount` and `judgment` into the row data, use `rowData.judgment ?? rowData.upsetAmount` with a `!= null` check in the amount cell, and use `formatSaleDate` in the sale-date column.

## 5. Verification

- [x] 5.1 Run `npm run build` and `npm run test` at the repo root, and `npm run lint` in `backend/`, `frontend/` and `packages/database/`. Fix any failures. Don't run the scraper locally or invoke the Lambda.
- [x] 5.2 Run `openspec validate validate-scraped-listings --strict` and fix any issues. A failure caused only by `listing-storage` not yet existing in `openspec/specs/` is expected until `listing-schema-fixes` is archived: note it in the PR description rather than restructuring the delta.
