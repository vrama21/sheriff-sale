## Why

Civilview limits Burlington County's sheriff notice fields to about 2,000 characters. When a notice is longer, the sheriff's office pastes the rest into the next detail fields in page order, Description → Parcel # → Property Note, splitting between words. `parseListingDetails` maps each label to its field as labelled, so for those listings:

- `Listing.parcel` holds the middle ~2,000 characters of the notice.
- `propertyNote` is ignored by `listingSchema`, so the last part of the notice is dropped.
- The real block/lot is somewhere in the notice, in the description or in the dropped Property Note.

On 2026-10-18, 89 of Burlington's 94 upcoming listings in prod had a parcel longer than 200 characters and a description of 1,900–2,000 characters. No other county had a parcel longer than 180 characters (Camden), and other counties' descriptions run to 7,029 characters, so the cap and the spill are Burlington's alone.

## What Changes

- After a details page is parsed (either layout), `parseListingSnapshot` runs `joinNoticeOverflow`. When the parcel is longer than any real parcel (more than 300 characters) and the description is near the cap (at least 1,800 characters), it joins Description, Parcel # and Property Note into `description` with single spaces, and leaves no `parcel` or `propertyNote`, so the listing is stored with a null parcel. Any other page is unchanged, and Property Note is still ignored.
- The rule keys on the fields' shape, not the county, so a page in another county that spills the same way is rejoined too.
- A scrubbed copy of an affected page (sheriff # 26001077) is added as the `listingDetailsBurlingtonOverflow.html` fixture.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `civilview-scraping`: adds a requirement that a notice that overflowed the description is rejoined.

## Impact

- Code: `backend/src/modules/sheriffSale/parse/joinNoticeOverflow.ts` (new), `parse/parseListingSnapshot.ts`, and tests. The daily scrape and `replay:archive` both parse through `parseListingSnapshot`, so both apply the rule.
- Data: no migration. The affected listings are still upcoming on civilview, so the next daily scrape re-parses them, and their content hash changes, so the sync updates them. Unaffected listings parse the same and keep their content hash.
- Out of scope: extracting the block/lot from a rejoined description back into `parcel`. Notices word it in several ways ("LOT 6.02 BLOCK 303", "BLOCK 303 LOT 6.02", "TAX LOT(S)"), and the planned clerk-records change already plans to extract block/lot from the description.
