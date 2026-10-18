## 1. Parse

- [x] 1.1 Add `parse/joinNoticeOverflow.ts`: `MAX_PARCEL_LENGTH` (300) and `MIN_CAPPED_DESCRIPTION_LENGTH` (1,800) as named constants with the evidence behind them, and a function that joins Description, Parcel # and Property Note into `description` when both thresholds are passed, and otherwise returns the listing unchanged.
- [x] 1.2 Run it in `parseListingSnapshot` on the output of either layout's parser.

## 2. Tests

- [x] 2.1 Add `__fixtures__/listingDetailsBurlingtonOverflow.html` from the archived page `listing-html-files/2026-10-18/property-id-2196778298.html`, with party, attorney and sheriff names and the attorney phone replaced by placeholders, as the other fixtures do. Keep the markup and line endings as served.
- [x] 2.2 `joinNoticeOverflow.test.ts`: the overflow fixture rejoins into one description and no parcel; the Passaic and Gloucester fixtures are unchanged; a normal parcel next to a long description, a long parcel next to a short description, and a parcel exactly at the threshold are unchanged; an empty property note leaves no trailing space.
- [x] 2.3 `parseListingSnapshot.test.ts` and `buildListingSnapshot.test.ts`: the overflow fixture parses to a rejoined description and builds a snapshot with a null parcel and no field warnings. The content hashes of the existing fixtures are unchanged.

## 3. Verification

- [x] 3.1 `vp test`, `vp lint`, `vp fmt --check` and the backend build pass.
- [x] 3.2 `openspec validate join-burlington-notice-overflow --strict` passes.
