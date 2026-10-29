## MODIFIED Requirements

### Requirement: Run fails when any county fails

The scraper handler SHALL run all 17 counties to completion, whether or not some fail: the 16 CivilView counties and Ocean from its PDF. It SHALL then throw an error that names every failed county whenever at least one county failed, so that the invocation is marked failed and the errors alarm and the dead-letter queue engage. It SHALL name failed counties from the list of runs it started, not by position in `NJ_COUNTIES`. It SHALL return a success message only when every county succeeded.

#### Scenario: All counties succeed

- **WHEN** every CivilView county and the Ocean PDF run resolve
- **THEN** the handler returns `New Jersey Sheriff Sale Scraper ran successfully.`

#### Scenario: One county fails

- **WHEN** one county rejects and the other 16 resolve
- **THEN** the other 16 counties' listings are still written, each failure cause is logged, and the handler throws an error that names the failed county

#### Scenario: Ocean fails

- **WHEN** the Ocean PDF run rejects, and all 16 CivilView counties resolve
- **THEN** the CivilView listings are still written, and the handler throws an error that names `Ocean` among `1/17` failed counties
