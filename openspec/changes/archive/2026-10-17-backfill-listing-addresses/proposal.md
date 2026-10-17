## Why

About 4,700 of prod's 7,956 listings have a wrong or missing `city`, and `adapt-scraper-to-civilview` only fixes listings scraped after it lands. The scraper read each address with `innerText`, which dropped the `<br/>` between the street and the `City NJ ZIP` line (`303 RENNER AVENUENEWARK NJ 07112`), and the old `cleanAddress` then guessed the city with a case-sensitive regex over the glued text. Checked read-only against prod on 2026-10-17:

- **City is wrong for most rows.** 1,416 are `NULL`, 1,778 are `''`, 1,334 start with `Nue` (`AVE` matched before `AVENUE`: `Nuenewark`), and 182 hold unit or mailing-address text (`Unit 6 Building 9 Turnersville`, `With A Mailing Address Of …`). Even rows that look fine can be wrong: `BAY` matched inside `BAYONNE` and left `Onne`.
- **The frontend shows it.** `ListingDetails.tsx` builds the displayed address as `street, city, state zipcode`, and only when both `street` and `city` are set. So listings show `…, Nuenewark, NJ 07112`, or no address line at all when the city is empty. (The city filter's options come from a static list, and `listing.list` filters by county only, so filtering isn't affected today.)
- **Addresses and sale dates carry scraper whitespace.** 5,071 addresses start with `\r` and end with a run of spaces. After `listing-schema-fixes` removed duplicates, 5,226 of the remaining 7,071 `saleDate` values still start with `\r`, and 133 are only whitespace.
- **Missing cities are stored two ways.** Prod has both `NULL` and `''` for "no city".
- **Old rows won't fix themselves.** Writes are insert-only, and the site issues a new `propertyId` on nearly every scrape (35,896 distinct IDs across 35,900 archived detail pages), so a re-scrape inserts a new row and never revisits the old one.
- **The archived HTML can't help.** The S3 archive starts on 2024-07-01, and only 141 stored rows have a real archived detail page. So the fix has to work from the stored `address` text.
- **The new `cleanAddress` can't read glued addresses.** Its fallback matches suffixes on word boundaries, so `AVENUENEWARK` matches nothing. It finds no city for 3,889 of the bad rows.

`state` is clean: every row is exactly `NJ`.

## What Changes

- Add a backfill generator that reads a read-only export of prod's `Listing` address fields. For each address it recovers the lost street / `City NJ ZIP` boundary, then runs the rebuilt two-line address through the same `cleanAddress` that new scrapes use. A prototype against prod on 2026-10-17 recovered the boundary for 7,330 of the 7,367 non-blank addresses (99.5%), and `cleanAddress` returned the recovered city for all 7,330.
- Rows with a blank address, or whose boundary can't be found, get `city = NULL`, so "no city" is always `NULL`. Their other derived fields are left as they are, and the report lists them. The boundary rules also accept `.` or `,` after a street suffix, and a route number glued to the town (`ROUTE 47DELMONT`), so prototype misses such as `239 12TH AVE.ATCO` and `4575 ROUTE 47DELMONT`, whose stored city was correct, don't lose it.
- Every row's `address` and `saleDate` get carriage returns removed, whitespace collapsed and ends trimmed. The date format is unchanged, and a `saleDate` that's only whitespace becomes `''`, because the column is NOT NULL in prod.
- The generator writes a review report (every planned change, plus the blank and unresolved rows) and a custom Drizzle migration that updates `address`, `city`, `street`, `zipcode`, `unit`, `secondaryUnit` and `saleDate` for the rows whose values change.
- The migration updates a row only if its `address`, `city` and `saleDate` still match the exported values, so it's safe against rows deleted or changed since the export, and a re-run changes nothing.

## Capabilities

### New Capabilities

- `listing-address-backfill`: How listings already in the database get their address fields repaired. Covers recovering the street / city boundary from a glued address, normalizing the same way new scrapes do, which rows are left alone, the review report, and the guarded, re-runnable update.

### Modified Capabilities

<!-- None. Address normalization for new scrapes is `civilview-scraping`, from adapt-scraper-to-civilview, which isn't archived yet; this change reuses it without changing its requirements. -->

## Impact

- Code: a new generator script and its tests under `backend/scripts/`. It imports `cleanAddress` and `ADDRESS_SUFFIX` from `backend/src/services/`, and keeps its own copy of the NJ town list that `adapt-scraper-to-civilview` deletes from `backend/src/services/constants/countyCities.ts`.
- Database: one custom migration under `packages/database/drizzle/`, applied to prod by CI's `migrate` job. It updates existing `Listing` rows in place, with no schema changes and no deletes.
- Frontend: no code changes. `ListingDetails` shows a correct address line for repaired rows, and still shows none for rows whose city becomes `NULL`.
- **Depends on** `adapt-scraper-to-civilview` (the new `cleanAddress` and suffix list), which hasn't merged yet. `listing-schema-fixes` has merged (#17), and its duplicate repair has run in prod, leaving 7,071 rows. The final export and generation run after `adapt-scraper-to-civilview` merges.
- Follow-up, not in this change: new scrapes still store `''` when `cleanAddress` finds no city, so new rows can reintroduce `''` unless the scraper stores `NULL` too.
- Out of scope: recovering blank addresses, canonical municipality names (the site's own wording is kept, e.g. `Buena Boro`, `Bridgeton (Upper Deerfield Twp)`), changing the `saleDate` format, `\r` in other columns, and unit-parsing gaps inside `cleanAddress` itself.
