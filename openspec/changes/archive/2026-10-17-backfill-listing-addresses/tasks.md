## 1. Prerequisites

- [x] 1.1 Build on `adapt-scraper-to-civilview` (it provides the new `cleanAddress` and `ADDRESS_SUFFIX`). If it has merged to `main`, branch from `main`; otherwise branch from `adapt-scraper-to-civilview` and say in the PR that it's stacked on it. `listing-schema-fixes` has already merged (#17), and prod has applied its `0004` and `0005`.

## 2. Generator

**Never connect to a database with write access, and never run `db:migrate`, `db:push` or `db:studio`.** The generator reads a JSON file and writes files; it doesn't connect to anything.

- [x] 2.1 Add `backend/scripts/backfillListingAddresses/towns.ts` with the NJ town list from the pre-civilview `backend/src/services/constants/countyCities.ts` (`git show main:backend/src/services/constants/countyCities.ts`), uppercased and de-duplicated.
- [x] 2.2 Add `recoverBoundary(address)` per spec "Recover the street and city boundary" (design Decision 2): known town by longest `endsWith`, then case boundary, then a glued `ADDRESS_SUFFIX` entry (including `ROUTE <number>`, and allowing one `.` or `,` before the town). Return the street part, the city text as stored, the ZIP, and the method used, or `undefined`.
- [x] 2.3 Add `separateGluedUnits(streetPart)` per spec "Re-separate glued unit lines".
- [x] 2.4 Add `cleanWhitespace(value)` for spec "Address whitespace" and "Sale date whitespace": remove `\r`, collapse whitespace runs, trim; empty stays `''`.
- [x] 2.5 Add `planRow(row)`: clean `saleDate`; if the address is blank or unresolved, set `city` to `NULL`, clean `address`, and leave the other derived fields (spec "Unknown city is NULL"); otherwise recover the boundary, re-separate units, and take the six address fields from `cleanAddress('<street part>\n<city> NJ <zip>')`. Return a planned update only when one of `address`, `city`, `street`, `zipcode`, `unit`, `secondaryUnit` or `saleDate` changes (spec "Plan only real changes").
- [x] 2.6 Add the CLI entry (`tsx backend/scripts/backfillListingAddresses/index.ts <export.json> <migration.sql> <report.csv>`): read the export, plan every row, write the CSV report (row id, county, method, each changed field's old and new value; blank and unresolved rows with their old city) and print the summary counts (spec "Review report"), assert every row's `state` is `NJ`, and write the migration SQL per design Decision 3: a guarded `UPDATE … FROM (VALUES …)` matching on `id`, old `address`, old `city` and old `saleDate`, with values escaped as SQL literals and `NULL` written as `NULL`.
- [x] 2.7 Add unit tests built from the spec scenarios: each boundary method, longest town wins, a unit letter glued to the town, punctuation between suffix and town, a route number glued to the town, unresolved, glued-unit re-separation (including `UNITY` left alone), blank address with `''` and with `NULL` city, unresolved row with a garbage city, `saleDate` with `\r`, with a time, and whitespace-only, a row already correct, and SQL escaping of `'` (`Hancock's Bridge`).

## 3. Generate and review

- [x] 3.1 Export prod's fields read-only into a scratch file outside the repo: `.claude/skills/db-query/scripts/query.sh --env prod --json 'SELECT id, county, state, address, city, street, zipcode, unit, "secondaryUnit", "saleDate" FROM "Listing"'`. If `PROD_DATABASE_URL` isn't available in the worktree, stop and ask the user to run the export.
- [x] 3.2 Create the migration shell with `npx drizzle-kit generate --custom --name backfill_listing_addresses` in `packages/database` (dummy `DATABASE_URL=postgres://localhost/unused` if none is set), then run the generator to fill it. Check it orders after `0005` in `drizzle/meta/_journal.json`.
- [x] 3.3 Review the summary against design Context (prototype counts minus the deleted duplicates). Spot-check at least 30 planned rows from each method, especially known-town rows whose old city differed, and every unresolved row whose old city looked correct. Add any missing towns to `towns.ts` and regenerate.
- [x] 3.4 Run `npm run db:generate` again and confirm it reports no schema changes.
- [x] 3.5 If possible, apply the migration to a local docker database loaded with the export and confirm a second run changes zero rows. Don't point anything at prod. _(Docker wasn't running, so this used a throwaway local Postgres 18 cluster with prod's `text` columns: one planned row deleted and one edited before the run were skipped, the other 6,953 planned rows matched the plan, and a second run left the table byte-identical.)_

## 4. Verification

- [x] 4.1 Run `npm run build`, `npm test` and `npm run lint` in `backend/`, and `npm run build` in `packages/database/`.
- [x] 4.2 Run `openspec validate backfill-listing-addresses --strict` and fix any issues.
- [x] 4.3 After CI applies the migration, re-run the checks in design Migration Plan step 4 read-only against prod and record the results here. _(2026-10-17, prod with all 12 migrations through `0011` applied, 3,752 listings: 0 `city` starting with `Nue`, 0 `city = ''`, 0 `city` with digits, 0 `address` with `\r`, 0 `address` with leading or trailing whitespace. `saleDate` is now a `date` column (from `validate-scraped-listings`), so its `\r`/whitespace checks are trivially 0.)_
