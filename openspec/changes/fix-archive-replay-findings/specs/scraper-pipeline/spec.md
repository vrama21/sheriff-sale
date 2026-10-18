## MODIFIED Requirements

### Requirement: County failure rule

A county run SHALL fail (reject) when any of these holds: its listings page can't be fetched or parsed; it found at least one listing and fewer than half of them parsed; or it attempted at least one database write and every write failed. In every other case it SHALL resolve, and log a summary of listings found, parsed, failed, inserted, and failed writes.

#### Scenario: Partial listing failures

- **WHEN** a county finds 100 listings, 97 parse, and 3 fail
- **THEN** the county resolves, its new listings are inserted, and the summary logs 3 failed listings

#### Scenario: Most listings fail

- **WHEN** a county finds 100 listings and 78 of them fail to fetch or parse, for example because the site serves its home page
- **THEN** the 22 parsed listings are written, and the county rejects with an error naming the county and the counts

#### Scenario: Exactly half parse

- **WHEN** a county finds 10 listings and 5 parse
- **THEN** the county resolves

#### Scenario: Every listing fails

- **WHEN** a county finds one or more listings and every one fails to fetch or parse
- **THEN** the county rejects with an error naming the county

#### Scenario: Every database write fails

- **WHEN** a county attempts one or more listing writes and every write fails
- **THEN** the county rejects with an error naming the county

#### Scenario: County with no listings

- **WHEN** a county's listings page parses to zero property IDs
- **THEN** the county resolves with nothing to write
