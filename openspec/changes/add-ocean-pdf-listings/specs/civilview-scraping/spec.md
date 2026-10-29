## MODIFIED Requirements

### Requirement: Correct and complete county IDs

The scraper SHALL scrape every New Jersey county that salesweb.civilview.com lists with sales, each with the site's county ID: Atlantic 25, Bergen 7, Burlington 3, Camden 1, Cape May 52, Cumberland 6, Essex 2, Gloucester 19, Hudson 10, Hunterdon 32, Middlesex 73, Monmouth 8, Morris 9, Passaic 17, Salem 20, Union 15. Ocean SHALL NOT be scraped on CivilView: its CivilView page has had no listings since 2/27/2026, and its listings come from the sheriff's PDF instead (see `ocean-pdf-scraping`). No two counties SHALL share an ID, and every scraped county SHALL have an ID.

#### Scenario: Passaic uses its own ID

- **WHEN** the scraper requests Passaic County's listings page
- **THEN** the request uses `countyId=17`, and the listings are labelled Passaic

#### Scenario: Duplicate ID

- **WHEN** two counties in the map share an ID
- **THEN** the county-map test fails

#### Scenario: Ocean isn't requested from CivilView

- **WHEN** a daily run completes
- **THEN** no request was sent to salesweb.civilview.com with `countyId=85`, and no `county-html-files/<date>/ocean-county.html` was archived
