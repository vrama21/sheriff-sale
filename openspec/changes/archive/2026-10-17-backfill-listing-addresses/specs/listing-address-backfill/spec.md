## ADDED Requirements

### Requirement: Recover the street and city boundary

The backfill SHALL find where the street ends and the city begins in a stored address whose `<br/>` was dropped. It SHALL look only at the text before the trailing `NJ` (with optional ZIP or ZIP+4), and SHALL try these methods in order, using the first that matches:

1. **Known town:** the longest name from the NJ town list that the text ends with, ignoring case.
2. **Case boundary:** in mixed-case text, the last place where a lowercase letter, digit, `.` or `)` is followed directly by an uppercase letter, where the rest of the text has no digits.
3. **Glued street suffix:** in uppercase text, the last street suffix from `ADDRESS_SUFFIX` (including `ROUTE <number>`) that starts a word and is followed by a letter, either directly or after a single `.` or `,`, where the rest of the text has no digits. When suffixes start at the same place, the longest wins (`AVENUE`, not `AVE`).

The city SHALL be the matched text as stored, not a canonical name from the list.

#### Scenario: Uppercase address with a known town

- **WHEN** the stored address is `303 RENNER AVENUENEWARK NJ 07112`
- **THEN** the street is `303 RENNER AVENUE` and the city is `NEWARK`, before normalization

#### Scenario: Longest town wins

- **WHEN** the stored address is `108 CRAWFORD STREETEAST ORANGE NJ 07018`
- **THEN** the city is `EAST ORANGE`, not `ORANGE`

#### Scenario: Unit letter glued to the town

- **WHEN** the stored address is `12 MAIN STREETUNIT 15BEAST ORANGE NJ 07018`
- **THEN** the street part is `12 MAIN STREETUNIT 15B` and the city is `EAST ORANGE`

#### Scenario: Mixed-case town not in the list

- **WHEN** the stored address is `206 Sumner StreetLandisville NJ 08326`
- **THEN** the street is `206 Sumner Street` and the city is `Landisville`

#### Scenario: Uppercase town not in the list

- **WHEN** the stored address is `37 KOHOMO AVENUESICKLERVILLE (GLOUCESTER TWP.) NJ 08081`
- **THEN** the street is `37 KOHOMO AVENUE` and the city is `SICKLERVILLE (GLOUCESTER TWP.)`

#### Scenario: Punctuation between suffix and town

- **WHEN** the stored address is `14 PHEASANT CT.SICKLERVILLE NJ 08081`
- **THEN** the street is `14 PHEASANT CT.` and the city is `SICKLERVILLE`

#### Scenario: Comma between suffix and town

- **WHEN** the stored address is `17 DEVON CT,HADDON TWP NJ`
- **THEN** the street part is `17 DEVON CT,` and the city is `HADDON TWP`

#### Scenario: Suffix letters inside the town

- **WHEN** the stored address is `37 KOHOMO AVENUESICKLERVILLE (GLOUCESTER TWP.) NJ 08081`
- **THEN** the `ST` inside `GLOUCESTER` doesn't count, because it doesn't start a word

#### Scenario: Route number glued to the town

- **WHEN** the stored address is `4575 ROUTE 47DELMONT NJ 08314`
- **THEN** the street is `4575 ROUTE 47` and the city is `DELMONT`

#### Scenario: No boundary found

- **WHEN** no method matches, as in `56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081`
- **THEN** the row is unresolved

### Requirement: Re-separate glued unit lines

The dropped `<br/>` also glued a unit line onto the street (`DRIVEUNIT 3114`). In the street part, the backfill SHALL insert a line break before `UNIT`, `APT`, `APARTMENT`, `SUITE`, `BLDG` or `BUILDING` (ignoring case) when the keyword directly follows a letter or `.` and is followed by a digit, `#`, `.` or whitespace. It SHALL NOT split before a keyword followed by a letter (`COMMUNITY`, `BAPTIST`), or anywhere else in the street part.

#### Scenario: Unit glued to an uppercase street

- **WHEN** the street part is `200 WINSTON DRIVEUNIT 3114`
- **THEN** it becomes `200 WINSTON DRIVE\nUNIT 3114`

#### Scenario: Unit glued to a mixed-case street

- **WHEN** the street part is `225 West Leeds AvenueUnit 74`
- **THEN** it becomes `225 West Leeds Avenue\nUnit 74`

#### Scenario: Keyword inside a street name

- **WHEN** the street part is `14 UNITY STREET` or `12 COMMUNITY DRIVE`
- **THEN** it is unchanged

### Requirement: Normalize like a new scrape

For each resolved row, the backfill SHALL rebuild the address as `<street part>\n<city> NJ <zip>`, using the street part after unit re-separation, using the ZIP from the five digits after `NJ` if there are any. It SHALL take `address`, `city`, `street`, `zipcode`, `unit` and `secondaryUnit` from the result of passing that address to the scraper's `cleanAddress`. It SHALL NOT normalize these fields any other way, so repaired rows match what a new scrape of the same page would store.

#### Scenario: Repaired row matches a new scrape

- **WHEN** the stored address is `303 RENNER AVENUENEWARK NJ 07112` with city `Nuenewark`
- **THEN** the planned values are address `303 RENNER AVENUE NEWARK NJ 07112`, street `303 Renner Avenue`, city `Newark` and zipcode `07112`, the same as `cleanAddress('303 RENNER AVENUE\nNEWARK NJ 07112')`

#### Scenario: Unit on its own line

- **WHEN** the stored address is `200 WINSTON DRIVEUNIT 3114CLIFFSIDE PARK NJ 07010`
- **THEN** the planned values have street `200 Winston Drive`, unit `Unit 3114` and city `Cliffside Park`

#### Scenario: Scraper whitespace

- **WHEN** the stored address is `\r 20 BRANFORD STREETNEWARK NJ 07114` followed by trailing spaces
- **THEN** the planned address has no `\r`, no leading or trailing whitespace, and no runs of spaces

### Requirement: Unknown city is NULL

When a row's address is empty or only whitespace, or its boundary can't be found, the backfill SHALL set `city` to `NULL`, and SHALL leave `street`, `zipcode`, `unit` and `secondaryUnit` unchanged. It SHALL never set `city` to `''` or to a value it didn't derive from the row's own address.

#### Scenario: Blank address with an empty city

- **WHEN** a row's address is empty and its city is `''`
- **THEN** its city is set to `NULL`, and the report lists it as blank

#### Scenario: Blank address already NULL

- **WHEN** a row's address is empty and its city is `NULL`
- **THEN** its city stays `NULL`, and the report lists it as blank

#### Scenario: Unresolved address with a garbage city

- **WHEN** a row's boundary can't be found and its city is `Oaklyn Nj 08107 Collingswood Bgh`
- **THEN** its city is set to `NULL`, its other derived fields are unchanged, and the report lists it as unresolved with its stored address and old city

### Requirement: Address whitespace

For every row, the backfill SHALL remove carriage returns, collapse runs of whitespace to one space, and trim the stored `address`, whether or not its boundary is found. An address that is empty after this SHALL become `''`, because prod's `address` column is NOT NULL.

#### Scenario: Unresolved address with scraper whitespace

- **WHEN** an unresolved row's address is `\r 56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081` followed by trailing spaces
- **THEN** its address becomes `56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081`

### Requirement: Sale date whitespace

For every row, the backfill SHALL remove carriage returns, collapse runs of whitespace to one space, and trim `saleDate`. It SHALL NOT change the date's format. A `saleDate` that is empty after this SHALL become `''`, because prod's `saleDate` column is NOT NULL.

#### Scenario: Leading carriage return

- **WHEN** a row's `saleDate` is `\r 7/5/2023` followed by trailing spaces
- **THEN** its `saleDate` becomes `7/5/2023`

#### Scenario: Date with a time

- **WHEN** a row's `saleDate` is `10/19/2026 02:00 PM`
- **THEN** it is unchanged

#### Scenario: Whitespace only

- **WHEN** a row's `saleDate` is `\r` followed only by spaces
- **THEN** its `saleDate` becomes `''`

### Requirement: Plan only real changes

The backfill SHALL plan an update for a row only when at least one of `address`, `city`, `street`, `zipcode`, `unit`, `secondaryUnit` or `saleDate` would change. It SHALL NOT modify `state` or any other column.

#### Scenario: Row already correct

- **WHEN** a row's stored fields already equal the planned values
- **THEN** no update is planned for it

#### Scenario: State untouched

- **WHEN** any update is planned
- **THEN** it doesn't include `state`, and the report confirms that every exported row's `state` is `NJ`

### Requirement: Review report

Before any data changes, the generator SHALL write a report that lists every planned update (row id, county, and each changed field's old and new values) and every blank and unresolved row. It SHALL also print summary counts: rows exported, already correct, planned updates by recovery method, blank, and unresolved.

#### Scenario: Generating the report

- **WHEN** the generator runs on an export
- **THEN** it writes the report and the migration without connecting to any database, and prints the summary counts

### Requirement: Guarded, re-runnable update

The backfill SHALL apply its planned updates as one custom Drizzle migration. Each update SHALL apply only if the row still exists and its `address`, `city` and `saleDate` still equal the exported values. Running the migration's SQL a second time SHALL change nothing.

#### Scenario: Row deleted since the export

- **WHEN** a planned row was deleted after the export (for example by `listing-schema-fixes`' duplicate repair)
- **THEN** the migration skips it and doesn't fail

#### Scenario: Row changed since the export

- **WHEN** a planned row's `address`, `city` or `saleDate` no longer equals the exported value
- **THEN** the migration leaves that row unchanged

#### Scenario: Re-run

- **WHEN** the migration's SQL runs again after it has been applied
- **THEN** no row's values change: rows whose guarded values changed are skipped, and any other planned row is written with the values it already holds
