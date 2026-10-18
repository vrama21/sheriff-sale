## ADDED Requirements

### Requirement: Supported PRESS counties

The clerk-records module SHALL configure a PRESS client for exactly Essex, Passaic, Monmouth and Burlington. Each county's configuration SHALL give its entry URL, its form field prefix, its maximum search window in days (null when there is none), whether it needs the `NewSearch` flag, whether it has a qualifier field, the earliest date its block/lot index covers, its municipality alias map, and its doc-type description map. A county with no PRESS configuration SHALL be reported as unsupported and SHALL NOT be requested.

#### Scenario: Supported county

- **WHEN** the pipeline runs for Monmouth
- **THEN** it uses `https://oprs.co.monmouth.nj.us/oprs/clerk/clerkhome.aspx?op=basic` with a 90-day maximum window

#### Scenario: Unsupported county

- **WHEN** the pipeline is asked to look up a listing in Bergen
- **THEN** no request is made to any Bergen host and the listing's lookup outcome is `unsupported`

### Requirement: WebForms session and postback

Before each search, the PRESS client SHALL GET the county's entry page and carry its session cookies. It SHALL submit every hidden input from the returned form (including `__VIEWSTATE`, `__VIEWSTATEGENERATOR` and `__EVENTVALIDATION`, when present), the selected tab's fields and that tab's search button. It SHALL set `hidCurrTab` to the tab's number, and SHALL set `hidDiv` to `NewSearch` for counties that require it. Field names SHALL be built from the county's configured prefix. Paging SHALL post back to the results page with `__EVENTTARGET` set to the pager control and the current page's hidden fields.

#### Scenario: Passaic's older field names

- **WHEN** the client runs a name search in Passaic
- **THEN** the posted form names its fields with the `_ctl0:PageContent:` prefix and includes `hidDiv=NewSearch`

#### Scenario: Monmouth needs the session cookie

- **WHEN** the client posts a Monmouth search
- **THEN** the request carries the session cookie set by the preceding GET of the entry page

#### Scenario: Next results page

- **WHEN** a result page shows a pager link to page 2
- **THEN** the client posts back with that link's event target and the hidden fields from page 1, and parses page 2's rows

### Requirement: Search modes

The PRESS client SHALL support name search (Tab 1: name, doc categories, from/to dates), block/lot search (Tab 4: municipality, block, lot, qualifier where the county has one, optional doc categories and dates), and instrument search (Tab 3). It SHALL translate doc categories into the county's dropdown option values using its doc-type map. It SHALL translate a municipality into the dropdown option value using the alias map, checked against the options on the live entry page.

#### Scenario: Doc categories to dropdown values

- **WHEN** a name search asks for `LIS_PENDENS` in Essex
- **THEN** the posted doc type values are those for `LIS PENDENS FORECLOSURE`, `LIS PENDENS FORECLOSURE AND RECOVERY`, `LIS PENDENS IN REM` and `LIS PENDENS RECOVERY`

#### Scenario: Unknown municipality

- **WHEN** a block/lot search names a municipality that no alias resolves to a live dropdown option
- **THEN** the client does not send the search, logs a warning naming the county and municipality, and the caller receives a `municipality_unresolved` result

### Requirement: Date windows within county limits

When a county has a maximum search window and the requested date range is longer, the PRESS client SHALL split the range into consecutive windows no longer than the maximum. It SHALL run them oldest first and return the union of their documents.

#### Scenario: Monmouth two-year range

- **WHEN** a Monmouth name search covers 1 January 2025 to 31 December 2026
- **THEN** the client sends 9 searches, each covering at most 90 days, and returns one deduplicated list of documents

#### Scenario: County without a limit

- **WHEN** an Essex name search covers three years
- **THEN** the client sends a single search for the whole range

### Requirement: Result grid parsing

The PRESS parser SHALL read the results grid's rows into Type, Direct Party, Indirect Party, Instrument #, Recorded date, Town, Block, Lot, Book and Page. It SHALL treat `N/A` and empty cells as null. It SHALL group rows by instrument number, or by book and page when the instrument number is empty, into one document with the union of its direct and indirect parties. A page with neither a results grid nor the portal's no-records marker SHALL be a parse error, not an empty result.

#### Scenario: One document across many party rows

- **WHEN** a result page lists instrument `2026051225` on 12 rows pairing 4 direct and 3 indirect parties
- **THEN** the parser returns one document with 4 distinct direct parties and 3 distinct indirect parties

#### Scenario: No records

- **WHEN** the portal answers a search with its no-records message
- **THEN** the parser returns an empty list without error

#### Scenario: Unexpected page

- **WHEN** a search returns a page with no results grid and no no-records message, such as an error page or a changed layout
- **THEN** parsing fails with an error naming the county and search, and the failure is counted as a parse error for the county

### Requirement: Result paging limit

The PRESS client SHALL request the largest rows-per-page option the county offers, and SHALL fetch at most `MAX_RESULT_PAGES` (5) pages per search. When it stops before the last page, it SHALL log the county, the search inputs and the total row count the portal reports.

#### Scenario: Truncated results

- **WHEN** a name search reports 1,200 matching rows across 12 pages
- **THEN** the client fetches 5 pages, returns the documents from them, and logs a truncation warning with the search inputs

### Requirement: Request politeness

The PRESS client SHALL send at most one request at a time to each county host, and SHALL wait at least 1.5 seconds between requests to the same host. Each request SHALL time out after 30 seconds. A network error or 5xx response SHALL be retried once after 5 seconds. A 4xx response SHALL NOT be retried. Three consecutive 403 or 429 responses from one host SHALL stop all further requests to that host for the rest of the run.

#### Scenario: Requests to one host are serialized

- **WHEN** two listings in Burlington are looked up in the same run
- **THEN** their requests to the Burlington host never overlap, and consecutive requests start at least 1.5 seconds apart

#### Scenario: Blocked host

- **WHEN** the Essex host answers three requests in a row with 429
- **THEN** no more requests go to the Essex host this run, its remaining listings are left for the next run, and Essex is reported as failed

#### Scenario: Transient server error

- **WHEN** a search POST returns 503 and the retry 5 seconds later returns 200
- **THEN** the search succeeds with the retried response

### Requirement: TLS verification stays on

The PRESS client SHALL verify every county's TLS certificate chain. When a host's chain is incomplete, its configuration MAY supply the missing intermediate certificate for that host's agent. The client SHALL NOT disable certificate verification for any host.

#### Scenario: Incomplete chain

- **WHEN** Burlington's server sends an incomplete certificate chain
- **THEN** the request succeeds only with the configured intermediate for that host, and requests to other hosts use the default trust store

### Requirement: Best-effort result page archive

The client SHALL save each result page to the `nj-sheriff-sale` bucket at `clerk-records/<county-slug>/<YYYY-MM-DD>/<listingId>-<step>-<n>.html` before parsing it, with a single `PutObject`. If saving fails, it SHALL log the error and parse the page anyway.

#### Scenario: Archive fails

- **WHEN** saving a result page to S3 throws
- **THEN** the error is logged and the page is still parsed and used for matching
