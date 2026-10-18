## ADDED Requirements

### Requirement: Notice overflow is rejoined

When a parsed details page has a `parcel` longer than 300 characters and a `description` of at least 1,800 characters, the scraper SHALL treat the parcel and property note as the rest of a notice that overflowed the description. It SHALL set `description` to the Description, Parcel # and Property Note values joined in page order with single spaces, skipping empty ones, and SHALL leave the listing without a parcel or property note. Any other page SHALL be parsed unchanged. The rule SHALL apply to both page layouts, in the daily scrape and in archive replay.

#### Scenario: Burlington notice split across three fields

- **WHEN** a details page's Description ends `…mortgage debt, including`, its Parcel # is 1,994 characters starting `costs and expenses, there remains any surplus money`, and its Property Note ends `Attorney (s): 555 555-0100`
- **THEN** the description is the three values joined with single spaces, from `APPROXIMATE GOOD FAITH ESTIMATE` through `Attorney (s): 555 555-0100`, and the listing's parcel is null

#### Scenario: Real parcel next to a long description

- **WHEN** a details page has a 2,000-character description and the parcel `BLOCK 303 LOT 6.02`
- **THEN** the description and parcel are stored as shown, and Property Note is ignored

#### Scenario: Long parcel next to a short description

- **WHEN** a details page has a parcel longer than 300 characters and a description shorter than 1,800 characters
- **THEN** the description and parcel are stored as shown
