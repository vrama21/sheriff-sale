## Why

A sheriff-sale listing doesn't say what the property is zoned for or what it's assessed at, and it doesn't carry a parcel ID that would let us look either up. The block and lot are buried in the notice text, and `Listing.city` is the mailing city, not the municipality. NJParcels (njparcels.com) serves every NJ parcel by its state ID, `<municipality code>_<block>_<lot>`. Its property page shows the assessment and, for some municipalities, the zone.

A dry run against prod (2026-10-18) shows we can build that ID for most upcoming listings from data we already store:

- `extractParcel` (written for clerk-records matching) finds a block and lot in 1,268 of 1,468 upcoming listings (86%). The clerk-records proposal's 22–27% figure predates #31. Atlantic and Cumberland notices never name a block or lot.
- The municipality comes from the notice text ("Township of Freehold") or from `city`. Together they resolve 1,292 of 1,468 (88%) with a rough prototype.
- Both together give 1,135 of 1,468 (77%) a full parcel ID.
- No listing has coordinates: `latitude`, `longitude` and `mapsUrl` are empty on all 6,226 rows. So the parcel ID has to come from the text.

Two smaller problems surfaced along the way. `NJ_COUNTIES` holds only the 17 counties civilview lists, not all 21, so it can't serve as the state's county list. The municipality codes look alphabetical but aren't reliably: renames and mergers break the order in 9 of the 21 counties. The code map has to be a snapshot of real data, not derived from names.

## What Changes

- **Split the county list.** `shared/nj` gets all 21 NJ counties, each with its 2-digit state code (Atlantic `01` … Warren `21`). The sheriff-sale scraper gets its own list of the 17 counties civilview serves, and its county-ID map, handler and replay arguments use that list. Mercer, Somerset, Sussex and Warren join the shared list only. civilview's "Sussex" is Sussex, **DE**, and must never be mapped.
- **Add a static municipality map** to `shared/nj`. It holds all 564 municipalities with their 4-digit codes, snapshotted from the njparcels home page by a checked-in script. Each name is stored as njparcels shows it ("Galloway Twp"), alongside its municipality type.
- **Add a postal-place alias table** for mailing cities that aren't municipalities (Williamstown → Monroe Twp, Gloucester). A place that spans two municipalities, like Sicklerville, maps to none.
- **Move `extractParcel` from `clerkRecords/parse/` to `shared/nj/`**, with `normalizeParcelValue` and `sameParcel`, so both modules can use it.
- **Resolve and store a parcel on every listing at ingest.** New `Listing` columns: `municipalityCode`, `block`, `lot`, `qualifier` and `pamsPin`. They are derived from `parcel`, `description` and `city`, and are part of the snapshot and its content hash. The municipality comes from the notice text first, then the city, then the alias table. An ambiguous or unknown municipality is NULL. A one-off script fills the columns on existing rows.
- **Add an `njParcels` backend module** with the standard stages. It selects upcoming listings that have a `pamsPin` and no fresh lookup. It fetches each property page with one request in flight and at least 5 seconds between requests, as the site's `robots.txt` asks. It parses the assessment (total, land, improvements), property type, acreage, last sale and the zone when stated. It stores one row per parcel, keyed by `pamsPin`, with a lookup status (`found`, `not_found`, `error`). Raw pages are archived to S3 on a best-effort basis.
- **Deploy it as a third Lambda**, `new-jersey-parcels`, on its own daily schedule after the scraper. It reuses the existing archive bucket, role and dead-letter queue. The backend build produces a third bundle.
- Start with a spike that finds how njparcels addresses condo units (qualifiers such as `C0001`) in its URLs and pins.

**Out of scope:**

- **Missing coordinates:** geocoding listings, and the `/nearby/` lookup that would need coordinates.
- **Atlantic and Cumberland:** they need an address search, which is a later change.
- **The frontend:** showing parcel data there waits on the terms-of-use decision.
- **Other parcel sources:** the NJOGIS MOD-IV dataset, scraping parcels that aren't tied to a listing, and lots beyond the first in a multi-lot notice.

**Open decision: njparcels' terms of use.** The terms grant "personal, non-commercial transitory viewing only". They forbid copying the materials, using them commercially, showing them publicly or mirroring them. This change stores the data for internal use and doesn't display it. Before anything is shown to users, we need to decide whether to:

- accept that risk,
- ask njparcels for permission, or
- take the assessment from the state's open MOD-IV parcel data and keep njparcels only for zoning.

## Capabilities

### New Capabilities

- `nj-geography`: The 21-county list and its state codes, the municipality code map and how it's regenerated, the postal-place alias table, and resolving a listing's municipality from its notice text and city.
- `listing-parcel`: Extracting block, lot and qualifier from listing text; building the parcel ID; the parcel columns on `Listing`, how ingest sets them, and the backfill.
- `njparcels-lookup`: Which listings get looked up and when to re-check them, request pacing, fetching and parsing the property page, the parcel table and its lookup status, failure handling, and the raw-page archive.

### Modified Capabilities

- `civilview-scraping`: "Correct and complete county IDs" now covers the sheriff-sale county list rather than all NJ counties. It also rules out civilview's non-NJ counties, such as Sussex, DE.
- `backend-module-layout`: `shared/nj/` also holds the county codes, the municipality map, the alias table, municipality resolution and parcel extraction. `modules/njParcels/` is a module.
- `listing-sync`: The snapshot fields, and so the content hash, include the derived parcel fields.
- `scraper-infrastructure`: Adds the `new-jersey-parcels` Lambda, its daily schedule and its log group. It shares the existing role, archive bucket and dead-letter queue.
- `infra-delivery`: "Lambda bundle build" also bundles `src/modules/njParcels/handler.ts`.

## Impact

- **Code:** `backend/src/shared/nj/` gains new files, and `extractParcel` moves there. `modules/sheriffSale` changes in its county map, `handler.ts`, `replay/args.ts` and `ingest/buildListingSnapshot.ts`. `modules/clerkRecords` changes the import path for `extractParcel`. `modules/njParcels/` is new.
- **Database:** five nullable columns and an index on `Listing.pamsPin`, plus a new `NjParcel` table, in one Drizzle migration. The first daily scrape after deploy reports every re-scraped listing as "updated" once, because its content hash now includes the parcel fields.
- **Infrastructure:** one Lambda, an EventBridge rule and a log group. No new IAM permissions. Raw pages go under the `njparcels/` prefix in the existing bucket.
- **External:** about 170 requests to njparcels.com a day at most (one per parcel, 5 seconds apart, within a 900-second run), less once the backlog is filled.
- **Ordering:** `add-clerk-records-press` should be archived first. This change's `infra-delivery` delta builds on the `clerkRecords` bundle that change adds.
