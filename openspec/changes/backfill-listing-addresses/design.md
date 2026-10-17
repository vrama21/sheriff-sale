## Context

The civilview details page shows an address as `<street>[<br/><unit or a.k.a. line>]<br/><City> NJ <ZIP>`. Until `adapt-scraper-to-civilview`, `parseListingDetails` read it with `innerText`, which dropped every `<br/>` without a space, so prod stores `303 RENNER AVENUENEWARK NJ 07112` and `200 WINSTON DRIVEUNIT 3114CLIFFSIDE PARK NJ 07010`. The old `cleanAddress` derived `city`, `street`, `zipcode`, `unit` and `secondaryUnit` from that glued text with case-sensitive regexes, and got the city wrong or empty for about 4,700 rows.

`adapt-scraper-to-civilview` rewrites `cleanAddress` to split on the line break, with a case-insensitive fallback that needs word boundaries. That works for new scrapes, but not for stored rows: there is no line break left, and the glued suffix (`AVENUENEWARK`) has no word boundary.

A prototype of the method below ran against a read-only export of prod on 2026-10-17 (7,956 rows):

| Outcome | Rows |
|---|---|
| Boundary found by known town | 5,843 |
| Boundary found by glued street suffix | 1,249 |
| Boundary found by case boundary | 238 |
| Unresolved | 37 |
| Blank or whitespace-only address | 589 |

`cleanAddress` returned the recovered city unchanged for all 7,330 resolved rows. Compared with what's stored, the city would be filled in for 2,587 rows, corrected for 1,664, and unchanged for 3,079. 160 street parts had a unit glued on; with the re-separation step, 156 of them get a unit or building extracted, against 64 without it.

`listing-schema-fixes` (#17) has merged, and prod has applied its `0004` (duplicate repair) and `0005`, leaving 7,071 rows. The prototype numbers above predate that; expect them to shrink by the deleted duplicates. This change's migration comes after `0005`.

Prod's `address` and `saleDate` columns are NOT NULL; `city`, `street`, `zipcode`, `unit` and `secondaryUnit` allow NULL. Of the 7,071 `saleDate` values, 5,226 start with `\r` and 133 are only whitespace. The rest are `M/D/YYYY` (6,871) or `M/D/YYYY hh:mm AM|PM` (67). Blank-address rows store their city as `NULL` (576) or `''` (13).

In the prototype, some of the 37 unresolved rows already had a correct city (`239 12TH AVE.ATCO` → `Atco`, `4575 ROUTE 47DELMONT` → `Delmont`), and others had garbage (`Unit 6 Building 9 Turnersville`, `Oaklyn Nj 08107 Collingswood Bgh`).

## Goals / Non-Goals

**Goals:**

- Every stored listing whose address can be read gets the same `address`, `city`, `street`, `zipcode`, `unit` and `secondaryUnit` that a new scrape of the same page would store.
- Every planned change can be reviewed before it reaches prod.
- No row loses information: an update happens only when the row's own address supports it.

**Non-Goals:**

- Rows with a blank address (589). Nothing in the DB or the S3 archive holds their address.
- Canonical municipality names. The site writes the same town several ways (`Buena Boro`, `Buena Vista Township`, `Mt. Laurel` / `Mt Laurel`, `Bridgeton (Upper Deerfield Twp)`); the backfill keeps the site's wording, as new scrapes do.
- Changing the `saleDate` format (for example to ISO dates, or dropping the time). Only its whitespace is cleaned.
- `\r` and padding in columns other than `address` and `saleDate`.
- Making new scrapes store `NULL` instead of `''` when `cleanAddress` finds no city. That belongs in the scraper; until it changes, new rows can reintroduce `''`.
- Fixing unit-parsing gaps inside `cleanAddress` (`APARTMENT` isn't a unit keyword; `Bldg. 22` and `Timeshare Estate No. 21` parse badly). Those belong to `cleanAddress`; once it improves, re-running the generator picks the improvements up.
- Checking a listing's town against its county. The prototype found towns outside the county's list (Morris rows in `Califon`, an Atlantic row whose address is an attorney's office in `Mt Laurel`), which is a data-quality question, not a parsing one.

## Decisions

### 1. Recover the boundary, then reuse `cleanAddress`

The backfill doesn't write its own address normalizer. It only puts back what `innerText` removed (the line break before the city, and before a glued unit line), then passes `<street part>\n<city> NJ <zip>` to the scraper's `cleanAddress`. Repaired rows and new rows then go through one code path, and any later fix to `cleanAddress` applies to both.

- _Alternative:_ call the new `cleanAddress` on the stored text directly. It finds no city for 3,889 of the bad rows, because its fallback needs a word boundary after the street suffix.
- _Alternative:_ a separate normalizer for old rows. It would drift from the scraper's output, so old and new rows would spell the same town differently.

### 2. Three methods for finding the boundary, in order

Only the text before the trailing `NJ [ZIP]` is searched, and the city is always the matched text as stored.

1. **Known town, longest match.** The stored address always ends with the town, whatever it's glued to, so `endsWith` works where regexes can't. Longest match avoids `ORANGE` in `EAST ORANGE`, and it handles a unit letter glued to the town (`…UNIT 15BEAST ORANGE`). This resolves 79% of rows on its own.
2. **Case boundary.** In mixed-case addresses the town starts at the last lowercase-then-uppercase transition (`StreetLandisville`). This covers villages and variant names that aren't in the list.
3. **Glued street suffix.** For uppercase addresses whose town isn't in the list: the last `ADDRESS_SUFFIX` entry followed by a letter, either directly or after one `.` or `,`, provided the remainder has no digits (`AVENUESICKLERVILLE (GLOUCESTER TWP.)`, `CT.SICKLERVILLE`). `ROUTE <number>` counts as a suffix, so `ROUTE 47DELMONT` splits after `47`. The prototype required a letter directly after the suffix, which left these unresolved. Unresolved rows lose their city (Decision 5), so resolving them matters more than it did.

- The town list comes from the curated `COUNTY_CITIES` (470 names). _Alternative:_ add the distinct cities already stored in prod. The prototype tried that: the polluted values matched first and produced cities like `Smillville` and `Emillville`.
- `adapt-scraper-to-civilview` deletes `countyCities.ts` because the scraper doesn't use it. The generator keeps its own copy next to the script, so the scraper doesn't carry an unused constant just for a one-off.

### 3. Generate a reviewed migration from an offline export

```
db-query --env prod --json  ──▶  listings.json  ──▶  generator (pure, offline)
                                                       ├─▶ report (CSV + summary)
                                                       └─▶ drizzle/00NN_backfill_listing_addresses.sql
                                                                 │  PR review
                                                                 ▼
                                                       CI migrate job ──▶ prod
```

- The generator reads a JSON export made with the read-only `db-query` skill (`id`, `county`, `state`, `address`, `city`, `street`, `zipcode`, `unit`, `secondaryUnit`). It never connects to a database, so it's a pure function that unit tests can cover, and it can run anywhere.
- It writes a custom Drizzle migration (`drizzle-kit generate --custom --name backfill_listing_addresses`), so prod is changed by the same CI `migrate` job, in the same transaction and order as `listing-schema-fixes`' migrations, with credentials nobody has to handle locally.
- The SQL is one `UPDATE "Listing" AS l SET … FROM (VALUES …) AS v(…) WHERE l.id = v.id AND l.address IS NOT DISTINCT FROM v.old_address AND l.city IS NOT DISTINCT FROM v.old_city AND l."saleDate" IS NOT DISTINCT FROM v.old_sale_date`. The guard makes it safe against rows deleted or edited after the export. A re-run changes nothing: rows whose guarded values were repaired no longer match, and the rest are rewritten with the values they already hold.
- _Alternative:_ a script that writes to prod directly. It needs a writable prod URL locally, its changes aren't reviewed in the PR, and nothing records that it ran.
- _Alternative:_ port the method to SQL. Longest match over 470 towns and the case-boundary rule are awkward in SQL, and the result couldn't reuse `cleanAddress`.

### 4. Plan only rows whose values change

A row is planned only if at least one of the seven fields (the six address fields plus `saleDate`) differs from what's stored. This keeps the migration and the report to real changes. `state` is never written; the report confirms that every exported row is `NJ` instead.

### 5. Unknown city is `NULL`

A blank address, or one whose boundary can't be found, gives `city = NULL`. That makes "no city" one value instead of two, and drops garbage cities on unresolved rows (`Unit 6 Building 9 Turnersville`). The row's other derived fields stay as they are, since there's nothing better to replace them with. `ListingDetails` already treats a falsy city as "no address line", so `NULL` and `''` look the same there.

- _Trade-off:_ an unresolved row whose stored city happened to be right loses it. The wider suffix rule (Decision 2) resolves the known cases, and the report lists every unresolved row with its old city, so any that are worth keeping can be handled before generating the final migration.

### 6. Whitespace cleanup for `address` and `saleDate`

Both columns get the same treatment on every row, resolved or not: remove `\r`, collapse whitespace runs, trim. Because both columns are NOT NULL in prod, a value that ends up empty becomes `''`, not `NULL`. For resolved rows `address` comes from `cleanAddress`, which already does this, so the rule only matters for blank and unresolved rows. `saleDate` keeps its format: it's a `text` column holding the site's own `M/D/YYYY [hh:mm AM|PM]`, and changing that would also mean changing how the frontend parses it.

## Risks / Trade-offs

- [The known-town method picks a shorter town that's really the end of a longer, unlisted one] → The report lists the method used for each row. Spot-check the known-town rows whose old city differed, and add missing towns to the list before generating the final migration.
- [The migration file is large: several thousand rows in `VALUES` (5,071 addresses need whitespace cleanup alone), roughly 1–2 MB of SQL] → It's generated, so review the CSV report rather than the SQL. The SQL can be split into several statements in the same file if a single statement is too big.
- [The export goes stale between generation and merge] → Insert-only writes never change old rows, and the guard skips any row whose address changed. New rows from the fixed scraper are already correct, and nothing plans updates for them.
- [The duplicate repair in `listing-schema-fixes` keeps the oldest copy of each group, and the export may include rows it will delete] → Export after `listing-schema-fixes` has merged and its migrations have run. If an export from before that is used, the guard skips deleted ids.
- [Gaps in `cleanAddress` carry over: unit text left in the street, for example] → Accepted (Non-Goals). The city is unaffected: all 7,330 resolved cities came through `cleanAddress` unchanged.

## Migration Plan

1. Wait for `adapt-scraper-to-civilview` to merge. (`listing-schema-fixes` has merged, and `0004`/`0005` are applied in prod.)
2. Export the address fields from prod with `db-query --env prod --json`, run the generator, and review the summary and report. Expect the prototype's counts (Context) minus the rows `listing-schema-fixes` deleted. Look into any count far from them.
3. Commit the generator and the generated migration, and put the summary in the PR description. Attach the full CSV report to the PR rather than committing it; the migration already holds the same values. CI's `migrate` job applies the migration on merge.
4. After it runs, re-run the bad-city checks read-only: no `city` starting with `Nue`, no `city = ''`, no digits in `city`, and no `address` or `saleDate` containing `\r` or leading or trailing whitespace.

Rollback: the report has every old value, so a reverse migration can be generated from it if needed. Nothing is deleted.

## Open Questions

- None blocking. (Resolved: unknown city is `NULL`; `saleDate` whitespace is cleaned in this change.)
