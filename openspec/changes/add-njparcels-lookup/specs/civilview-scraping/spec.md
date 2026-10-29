## MODIFIED Requirements

### Requirement: Correct and complete county IDs

The scraper SHALL scrape every New Jersey county that salesweb.civilview.com lists, and only those, each with the site's county ID: Atlantic 25, Bergen 7, Burlington 3, Camden 1, Cape May 52, Cumberland 6, Essex 2, Gloucester 19, Hudson 10, Hunterdon 32, Middlesex 73, Monmouth 8, Morris 9, Ocean 85, Passaic 17, Salem 20, Union 15. This list SHALL be the sheriff-sale module's own county list, separate from the shared list of all 21 NJ counties. Mercer, Somerset, Sussex and Warren SHALL NOT be scraped while civilview doesn't list them. No county SHALL be mapped to a civilview county outside New Jersey. No two counties SHALL share an ID, and every scraped county SHALL have an ID.

#### Scenario: Passaic uses its own ID

- **WHEN** the scraper requests Passaic County's listings page
- **THEN** the request uses `countyId=17`, and the listings are labelled Passaic

#### Scenario: Duplicate ID

- **WHEN** two counties in the map share an ID
- **THEN** the county-map test fails

#### Scenario: County without a civilview page

- **WHEN** the daily handler runs
- **THEN** it scrapes the 17 listed counties, and makes no request for Mercer, Somerset, Sussex or Warren

#### Scenario: Sussex, Delaware

- **WHEN** the county-ID map is read
- **THEN** no county maps to `12`, civilview's ID for Sussex County, DE

#### Scenario: Replay rejects an unscraped county

- **WHEN** the archive replay is run with `--county Mercer`
- **THEN** it exits with an unknown-county error that lists the 17 sheriff-sale counties
