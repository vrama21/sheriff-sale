## ADDED Requirements

### Requirement: Correct and complete county IDs

The scraper SHALL scrape every New Jersey county that salesweb.civilview.com lists, each with the site's county ID: Atlantic 25, Bergen 7, Burlington 3, Camden 1, Cape May 52, Cumberland 6, Essex 2, Gloucester 19, Hudson 10, Hunterdon 32, Middlesex 73, Monmouth 8, Morris 9, Ocean 85, Passaic 17, Salem 20, Union 15. No two counties SHALL share an ID, and every scraped county SHALL have an ID.

#### Scenario: Passaic uses its own ID

- **WHEN** the scraper requests Passaic County's listings page
- **THEN** the request uses `countyId=17`, and the listings are labelled Passaic

#### Scenario: Duplicate ID

- **WHEN** two counties in the map share an ID
- **THEN** the county-map test fails

### Requirement: One session per county

Each county run SHALL use its own HTTP client and session. It SHALL send that county's listings-page response session cookie on every details request it makes. Counties running at the same time SHALL NOT share or overwrite one another's session.

#### Scenario: Two counties in parallel

- **WHEN** two counties run at the same time and their searches return different `ASP.NET_SessionId` cookies
- **THEN** each county's details requests carry only its own county's session cookie

#### Scenario: Session from the county's own search

- **WHEN** a county run fetches its listings page and the response sets an `ASP.NET_SessionId`
- **THEN** every details request in that county run sends that session ID

### Requirement: Redirects fail the listing

A details request SHALL NOT follow redirects. A 3xx response SHALL fail that listing with an error that names the `propertyId` and says the session was rejected.

#### Scenario: Session rejected

- **WHEN** a details request returns 302 with `Location: /`
- **THEN** fetching that listing rejects with an error naming the `propertyId` and the redirect, and the home page is never parsed

### Requirement: Listing details parsing

The scraper SHALL parse listing details from the `sale-detail-item` label/value layout. It SHALL map labels to listing fields through `cleanPropertyKey`, log and drop labels that aren't listing fields, decode HTML entities in values, collapse whitespace, and keep the address's line break between the street and the city line. If the page has no `sale-detail-item` elements, parsing SHALL throw an error saying the layout wasn't recognised.

#### Scenario: Current layout

- **WHEN** a details page shows Sheriff #, Court Case #, Sales Date, Plaintiff, Defendant, Address, Description, Approx. Upset*, Attorney and Parcel # as `sale-detail-item` pairs
- **THEN** the result has `sheriffId`, `courtCase`, `saleDate`, `plaintiff`, `defendant`, `address`, `description`, `upsetAmount`, `attorney` and `parcel` set to the values' decoded, trimmed text

#### Scenario: County shows judgment instead of upset

- **WHEN** a details page shows `Approximate Judgment` and no upset label
- **THEN** the value is stored as `judgment`

#### Scenario: Unknown label

- **WHEN** a details page shows a label that isn't a listing field, such as `Property Note`
- **THEN** the label is logged and left out of the result, and the other fields still parse

#### Scenario: Unrecognised page

- **WHEN** the HTML has no `sale-detail-item` elements, such as the site's home page
- **THEN** parsing throws an error saying the listing details layout wasn't recognised

### Requirement: Status history parsing

The scraper SHALL parse status history from the details page's status table, selecting it by id `longTable` or by a Status / Date header, and reading each body row's first two `td` cells as status and date. A table with no body rows SHALL produce an empty history. A page without the table SHALL throw an error saying the layout wasn't recognised.

#### Scenario: History rows

- **WHEN** the status table has rows `Scheduled 9/19/2023` and `Adjourned - Defendant 10/17/2023`
- **THEN** the history is `[{ status: 'Scheduled', date: '9/19/2023' }, { status: 'Adjourned - Defendant', date: '10/17/2023' }]`, without the header row

#### Scenario: Minified markup

- **WHEN** the table's rows have no whitespace between cells
- **THEN** the history parses the same as with whitespace

#### Scenario: No status table

- **WHEN** the page has no status table
- **THEN** parsing throws an error saying the status history layout wasn't recognised

### Requirement: Address normalization

The scraper SHALL split an address into street, city and ZIP, for both upper- and mixed-case input. It SHALL use the line break between the street and the `City NJ ZIP` line when there is one. Otherwise it SHALL match street suffixes case-insensitively on word boundaries. It SHALL take the ZIP from the five digits after `NJ`, and title-case the street and city while keeping hyphens and apostrophes.

#### Scenario: Mixed case with line break

- **WHEN** the address is `8 Floyd Drive\nTotowa NJ 07512`
- **THEN** street is `8 Floyd Drive`, city is `Totowa`, zipcode is `07512`, and address is `8 Floyd Drive Totowa NJ 07512`

#### Scenario: Avenue

- **WHEN** the address is `7 WEBSTER AVENUE STRATFORD NJ 08084`
- **THEN** street is `7 Webster Avenue` and city is `Stratford`

#### Scenario: Suffix inside a city name

- **WHEN** the address is `121 KNIGHT AVENUE RUNNEMEDE NJ 08078`
- **THEN** street is `121 Knight Avenue` and city is `Runnemede`

#### Scenario: House-number range

- **WHEN** the address is `40-42 MYRTLE STREET\nBRIDGETON NJ 08302`
- **THEN** street is `40-42 Myrtle Street`

#### Scenario: ZIP+4

- **WHEN** the address is `142 MANOR AVE OAKLYN NJ 08107-1133`
- **THEN** zipcode is `08107` and city is `Oaklyn`

### Requirement: Archive stores the page as served

The scraper SHALL archive each county listings page and details page to S3 exactly as the site served it, without decoding HTML entities first.

#### Scenario: Escaped characters

- **WHEN** a details page contains `&lt;` in a value
- **THEN** the archived HTML still contains `&lt;`, and the parsed value contains `<`
