## Context

The backend has two modules. `sheriffSale` scrapes civilview daily and syncs `Listing` and `StatusHistory`. `clerkRecords` looks up PRESS clerk records for listings in four counties. Neither stores a parcel ID for a listing. `extractParcel` (`clerkRecords/parse/extractParcel.ts`) reads block, lot and qualifier out of `parcel` and `description` on demand during clerk matching, then discards them.

**NJParcels** (njparcels.com) serves every NJ parcel by its state ID (the "PAMS PIN"): `<4-digit municipality code>_<block>_<lot>[_<qualifier>]`, for example `0714_2001_1`. These pieces of the site matter here:

| Path                             | What it gives                                                                                                                                             | Notes                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/`                              | All 21 counties and 564 municipalities, as `<h3>County</h3>` followed by `<a href="/property/<code>/">Name</a>`                                           | One request covers the whole map                                                                                |
| `/property/<code>/<block>/<lot>` | Property page: address, type, building description, acreage, zone (when known), last sale, deed book/page, assessed total/land/improvements, annual taxes | An unknown parcel answers `303 → /search/`. Values sit in `<noscript>` next to the `writeCurrency(...)` scripts |
| `/api/v1.0/property/<pin>.json`  | GeoJSON: pin, county and municipality names, address, owner mailing address, last sale, taxes, geometry                                                   | No assessment and no zone. An unknown pin answers 404                                                           |
| `/nearby/update/?x=&y=`          | Parcels near a NJ State Plane (EPSG:3424, US ft) point, with full assessment and property class                                                           | Not usable: listings have no coordinates                                                                        |

`robots.txt` allows everything with `Crawl-delay: 5`. Owner names are shown as "Redacted" (Daniel's Law). The zone appears as "…is listed as being within the **PP** zone for Washington Twp." on pages that have it. Pages without it link only to a zoning map. We haven't measured the share of each.

What the prod data says, from a dry run on 2026-10-18 over 1,468 upcoming listings:

```
extractParcel finds block/lot          1,268  86%   (Atlantic and Cumberland: 0 — notices never name one)
municipality resolved (text, then city) 1,292  88%   (rough prototype, no alias table)
both → full pin                        1,135  77%
has latitude/longitude                     0   0%   (all 6,226 rows)
```

Municipality codes follow the official MOD-IV district numbering. It is alphabetical within each county only where nothing was renamed or merged. Counter-examples:

- **Renames:** `0717` City of Orange Twp, `1430` Long Hill Twp, `1346` Lake Como.
- **Gaps left by mergers:** `1109`/`1110` before Princeton `1114`; `0429` Pine Valley; `2118` Pahaquarry.
- **Odd ordering:** `0416` Haddon Twp comes before `0417` Haddonfield.

`NJ_COUNTIES` (`shared/nj/njCounty.ts`) lists only the 17 counties civilview serves. `sheriffSale/handler.ts` scrapes every entry, and `NJSheriffSaleCountyIdMap` is a `Record<NJCounty, string>`. civilview's page also lists "Sussex, DE" (`countyId=12`).

## Goals / Non-Goals

**Goals:**

- One list of all 21 counties with their state codes, kept separate from the counties the sheriff-sale scraper covers.
- A static, checked-in map from municipality code to county and name, regenerable by a script.
- A municipality code, block, lot, qualifier and PIN on each listing whose text supports them, set by the same ingest path as every other listing field.
- Zone and assessment for each upcoming listing with a PIN, fetched no faster than njparcels asks and re-checked rarely.

**Non-Goals:**

- Geocoding listings, or any coordinate-based lookup.
- Atlantic and Cumberland. Their notices have no block/lot, so they need njparcels' address `/search/`. That's a later change.
- Showing parcel data in the frontend. This waits on the terms-of-use decision (Open Questions).
- Parcels beyond the first lot of a multi-lot notice (76 listings).
- Bulk-mirroring njparcels, or parcels not tied to a listing.
- Owner names: they're redacted.

## Decisions

### D1. Two county lists: the state's and the scraper's

`shared/nj/njCounty.ts` becomes:

```ts
export const NJ_COUNTY_CODES = { Atlantic: '01', Bergen: '02', …, Warren: '21' } as const;
export type NJCounty = keyof typeof NJ_COUNTY_CODES;
export const NJ_COUNTIES = Object.keys(NJ_COUNTY_CODES) as NJCounty[];   // all 21, alphabetical
```

`modules/sheriffSale/scrape/njSheriffSaleCountyIdMap.ts` defines the scraper's list:

- `SHERIFF_SALE_COUNTIES`: the 17 counties, as a `readonly NJCounty[]`.
- `SheriffSaleCounty`: their type.
- `NJSheriffSaleCountyIdMap: Record<SheriffSaleCounty, string>`.

The handler, `replay/args.ts` and the county-map test switch to `SHERIFF_SALE_COUNTIES`. Code that takes any county (`Listing.county`, clerk records, njParcels) keeps `NJCounty`.

_Alternative considered:_ add the 4 counties to `NJ_COUNTIES` with no civilview ID. The `Record` type then fails to compile. If it's loosened to `Partial`, the daily run gains 4 counties that always fail, and #32's failure alarm fires every day. Keeping the lists separate keeps the compile-time check that every scraped county has an ID.

### D2. The municipality map is a snapshot, not a formula

`shared/nj/njMunicipalities.ts` exports a generated `NJ_MUNICIPALITIES` array. Each entry is `{ code: '0714', county: 'Essex', name: 'Newark City', baseName: 'newark', kind: 'city' }`.

- `name` is njparcels' display name.
- `kind` comes from the name's suffix: `twp`→township, `boro`→borough, `city`, `town`, `village`, or none for names like "Princeton".
- `baseName` is the name lowercased, with the suffix and punctuation removed. It is the matching key.

A script, `backend/src/shared/nj/scripts/snapshotMunicipalities.ts`, fetches `/` once, parses the `<h3>`/anchor pairs, and rewrites the file. A test pins the shape:

- 21 counties and 564 entries.
- Unique codes.
- Each code's first two digits equal its county's code.

_Alternative considered:_ derive codes from alphabetical order. That's wrong for 9 of the 21 counties (Context).

_Alternative considered:_ the NJOGIS MOD-IV district list. It's authoritative, but njparcels is the system the PIN is used against. Its own map guarantees the codes we send are the ones it serves.

### D3. Resolving a listing's municipality

`shared/nj/resolveMunicipality.ts`: `resolveMunicipality({ county, parcel, description, city }) → { code, source } | null`. Matching is always within the listing's county, and tries three sources in order:

1. **Notice text.** The first `(Township|Borough|City|Town|Village) of <Name>` or `Municipality: <Name>` in `parcel`, then in `description`. The name's `baseName` must match. If more than one municipality shares that `baseName` (Egg Harbor City vs Egg Harbor Twp), the word before "of" picks the one whose `kind` agrees. If that leaves no single match, it falls through.
2. **City.** `city`'s `baseName`, then any parenthetical in it ("Bridgeton (fairfield Township)"), must match exactly one municipality.
3. **Alias.** `city` looked up in `NJ_POSTAL_PLACE_ALIASES` (`shared/nj/postalPlaceAliases.ts`), a hand-kept `Record<NJCounty, Record<string, string>>` from postal place to code. It starts with the misses from the dry run: Williamstown, Franklinville, Sewell, Browns Mills, Colonia and others. A place that spans municipalities, like Sicklerville (Winslow and Gloucester Twp), is deliberately absent.

The text comes first because the notice names the municipality whose tax map the block and lot belong to. The city is only the mailing city.

_Alternative considered:_ a fuzzy match on `city`. A near miss names a different taxing district and gives a wrong but plausible PIN. Exact matching with an explicit alias list fails visibly.

### D4. Parcel fields are snapshot fields

`extractParcel`, `normalizeParcelValue` and `sameParcel` move to `shared/nj/extractParcel.ts`. Clerk records imports them from `shared/nj`.

`buildListingSnapshot` adds five fields to `SnapshotListing` and `SNAPSHOT_FIELDS`:

- `municipalityCode`: from D3.
- `block`, `lot`, `qualifier`: from `extractParcel`. `lot` is the first lot.
- `pamsPin`: set only when the code, block and lot are all present, as `<code>_<block>_<lot>`, plus `_<qualifier>` per the D7 spike. Block and lot are uppercased and keep their original form, apart from stripping leading zeros in the integer part (`normalizeParcelValue`).

Because they're snapshot fields, they enter the content hash. Two consequences follow:

- **Resolver improvements reach existing rows.** When the resolver or alias table improves, every re-scraped listing whose derived values change is updated by the normal sync rule. No special path is needed.
- **A one-time burst of updates.** The first scrape after deploy reports each re-scraped listing as "updated" once, because the stored hash predates the new fields.

The backfill script `modules/sheriffSale/ingest/backfillListingParcels.ts` (npm `backfill:parcels`):

- Recomputes the five fields for every row from its stored `parcel`, `description`, `city` and `county`.
- Writes only rows whose values differ, in batches.
- Doesn't touch `contentHash`, `snapshotDate` or `updatedAt`.
- Can be re-run after alias changes, for listings that are no longer scraped.

_Alternative considered:_ resolve the PIN inside the njParcels module and store it there. Then `Listing` still has no parcel ID, and clerk records, njParcels and the frontend would each derive it separately.

### D5. One request per parcel: the property page

The module fetches only `/property/<code>/<block>/<lot>[/<qual>]`. That page has everything we keep: zone, assessment, type, acreage, sale and deed. The JSON API adds only geometry and the owner's mailing address, and the nearby endpoint needs coordinates.

One request per parcel at 5-second spacing fits about 170 lookups into a 900-second Lambda run.

`parse/parsePropertyPage.ts` reads:

- **Identity check:** the sentence "is Block `B`, Lot `L` in `<Municipality>`, `<County>` County." Its block and lot must match the request, or the result is an `error` (a redirect to a different parcel).
- **Property table:** Type, Building Description, Acreage, from the `<th>`/`<td>` rows.
- **Zone:** `within the <b>(…)</b> zone`. Null when absent.
- **Money and dates:** each value read from the `<noscript>` element that follows the "last sold for", "on", "assessed for", "assessed at" and "improvements … assessed at" phrases.
- **Taxes:** "costs the property's owners `X` annually".
- **Deed:** "in Book `B` on Page `P`".

Parsing is tested against checked-in fixtures: Newark `0714/2001/1` with no zone, Washington Twp `0336/10.01/1` with zone `PP`, and a condo page from the D7 spike. A page whose identity sentence is missing is an `error` with the reason recorded, so a site redesign fails loudly instead of storing NULLs.

### D6. Pacing and failure handling

The `njParcels` HTTP client wraps `shared/http`:

- **Pacing:** one request in flight, and at least 5,000 ms from the end of one response to the start of the next request.
- **User agent:** the same browser user agent the clerk client uses.
- **Redirects aren't followed.** `303` to `/search/` means `not_found`. Any other redirect means `error`.
- **Backing off:** a `429` or `5xx` records `error` for that parcel and doubles the delay for the rest of the run. Three errors in a row end the run early with a logged reason.
- **Time budget:** the pipeline stops starting new lookups when the Lambda has less than 30 seconds left.

### D7. Spike: condo qualifiers

Before building the PIN format, find a condo listing (qualifier `C0001`-style; 163 listings have one) and record:

- how njparcels addresses it, whether `/property/<code>/<block>/<lot>/<qual>` or something else;
- what the JSON API's `qual` field holds;
- whether a lot-level page exists for a condo lot.

The result fixes the `pamsPin` qualifier suffix in D4 and adds a parser fixture. If units can't be addressed, `pamsPin` for a qualified parcel is NULL, and the lookup is skipped rather than fetching the wrong unit.

### D8. Storage

A new `NjParcel` table, keyed by `pamsPin` (unique):

- **Identity:** `pamsPin`, `municipalityCode`, `block`, `lot`, `qualifier`.
- **Lookup state:** `status` (enum `NjParcelLookupStatus`: `found`, `not_found`, `error`), `lastError`, `checkedAt`, `firstFoundAt`.
- **Parsed fields:**
  - text: `propertyLocation`, `propertyType`, `buildingDescription`, `zone`, `deedBook`, `deedPage`
  - `numeric(14,2)`: `acreage`, `assessedTotal`, `assessedLand`, `assessedImprovement`, `lastSalePrice`, `annualTaxes`
  - date: `lastSaleDate`
- **Timestamps:** `createdAt`, `updatedAt`.

`Listing.pamsPin` is indexed and joins to it, so a parcel shared by two listings (a re-listed sale) is fetched once.

A write sets the lookup state every time. It overwrites the parsed fields only on `found`. A later `error` therefore never clears good data.

_Alternative considered:_ columns on `Listing`. Lookup state and re-check timing would then be tangled into the listing sync, which is what clerk records avoided with its own lookup table.

### D9. Selection and re-check schedule

Candidates are the distinct `pamsPin`s of listings with `saleDate >= today` that have no `NjParcel` row, or whose row is due:

| Status      | Due after                            |
| ----------- | ------------------------------------ |
| `found`     | 180 days (assessments change yearly) |
| `not_found` | 30 days                              |
| `error`     | next run                             |

Never-checked PINs go first, then the oldest `checkedAt`. A run with nothing due exits successfully without making any requests.

### D10. Deployment

`modules/njParcels/handler.ts` is bundled to `backend/dist/njParcels/index.js`. `infra/njParcels.tf` mirrors `infra/clerkRecords.tf`:

- **Function:** `new-jersey-parcels`, runtime `nodejs24.x`, 512 MB, a 900-second timeout. Its only environment variable is `DATABASE_URL`.
- **Shared resources:** the scraper's role and its DLQ. Async retries are 0.
- **Schedule:** EventBridge `cron(0 4 * * ? *)`, after the scraper (00:00) and clerk records (02:00).
- **Logs:** log group `/aws/lambda/new-jersey-parcels` with 90-day retention.
- **Archive:** raw pages go to `nj-sheriff-sale` under `njparcels/<code>/<YYYY-MM-DD>/<pin>.html`, best-effort.

The handler returns a summary: looked up, found, not_found, error and skipped (budget). It throws only when no lookup succeeded and at least one was attempted, so the DLQ alarm signals a site outage or a parser break, not a single bad parcel.

## Risks / Trade-offs

- **[Terms of use]** The njparcels terms forbid copying, commercial use and public display. → The data is stored and not displayed. The decision on display is an open question. The table's assessment columns can be refilled from MOD-IV if we switch sources, because both key on `pamsPin`.
- **[Wrong municipality gives a plausible wrong parcel]** → Exact matches only, an explicit alias table, and ambiguity resolving to NULL. The page's identity sentence must match the requested block and lot. `resolveMunicipality` returns its `source`, which is logged in the backfill summary so misses and alias candidates can be reviewed.
- **[Content-hash churn on deploy]** One "updated" per re-scraped listing on the first day. → Expected and documented. Status history isn't affected, and replay idempotency still holds afterwards.
- **[Zoning coverage unknown]** Many pages carry no zone. → `zone` is nullable. The first runs' summaries report the share, and that number decides whether a municipal zoning source is worth a later change.
- **[Backlog]** About 1,135 PINs at ~170 a day take about a week to fill. → Acceptable. The schedule can move to twice daily without a design change.
- **[Site changes]** The parser keys on prose sentences. → Fixture tests, identity-sentence verification, and the "no success" failure rule surface a redesign on the first run.
- **[Block/lot format drift]** For example `10.01` vs `10.1`, or leading zeros. → Values are normalized once, in `normalizeParcelValue`, and a `not_found` is re-checked after 30 days. The dry run's `not_found` rate is the signal to revisit.

## Migration Plan

1. Archive `add-clerk-records-press` (its `infra-delivery` text is the base for this change's delta).
2. Ship the county split, the municipality map, the aliases, the `extractParcel` move and the `Listing` columns (Drizzle migration) together. Deploy. Run `backfill:parcels` against prod and review its summary: resolved counts per county, and the top unresolved cities.
3. Ship the `NjParcel` table, the module and the infrastructure. Invoke the Lambda once by hand and check the summary and a sample of rows. Then let the schedule run.

**Rollback:** disable the EventBridge rule. The columns and table are additive. Reverting the ingest change leaves the stored parcel fields in place, and they're harmless.

## Open Questions

- **Terms of use:** accept the risk, ask njparcels for permission, or source assessment from MOD-IV and keep njparcels only for zoning? This must be decided before any frontend work.
- **Condo addressing:** see the D7 spike.
- **Zone coverage:** what share of looked-up parcels have one? Measure on the first runs.
- **Atlantic and Cumberland (132 upcoming):** is an address-search change worth it?
