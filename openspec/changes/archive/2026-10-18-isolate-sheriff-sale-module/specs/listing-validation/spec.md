## MODIFIED Requirements

### Requirement: Scraped listings are validated before storage

Every listing the scraper parses SHALL pass through a Zod 4 schema before it's enriched and saved. The schema's output type SHALL be the TypeScript type the rest of the pipeline uses, so no `as` cast stands between the parsed HTML and the database insert.

#### Scenario: Validated listing is saved

- **WHEN** a listing page's detail table has a valid `Address` and `Upset Amount` of `$1,585.95`
- **THEN** the listing passed to `saveListing` has `upsetAmount` equal to the number `1585.95`

#### Scenario: No unchecked casts

- **WHEN** `backend/src/modules/sheriffSale/` is searched for `as ListingParse` and `as string` on parsed fields
- **THEN** no matches are found
