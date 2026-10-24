## ADDED Requirements

### Requirement: A missing address does not reject a listing

A listing whose `address` is missing, or is empty after trimming, SHALL be stored with `address`, `street`, `unit`, `secondaryUnit`, `city` and `zipcode` NULL, and a field warning naming `address` SHALL be recorded. When any other field fails validation or coercion, the listing SHALL still be saved, with that field set per the coercion rules, and a field warning SHALL be recorded. Only a missing sheriff number SHALL reject a listing.

#### Scenario: Blank address row

- **WHEN** a listing's detail table has an `Address` row whose cell is whitespace-only, and a sheriff number of `F-4127`
- **THEN** the listing is saved with a NULL `address`, its other fields set, and one field warning naming `address`

#### Scenario: No address row

- **WHEN** a listing's detail table has no address row at all
- **THEN** the listing is saved with a NULL `address`, and a field warning names `address`

#### Scenario: Bad money value does not reject the listing

- **WHEN** a listing has a valid address and `Upset Amount` of `TBD`
- **THEN** the listing is saved with `upsetAmount` NULL and one field warning naming `upsetAmount`, the value `TBD` and the `propertyId`

### Requirement: Upset amount from free text

When a page has no upset row, or its upset row is empty, `upsetAmount` SHALL be taken from the page's free text, checked in this order: `Property Details`, `Property Note`, `Description`. In each, the upset amount SHALL be the first dollar figure that follows an upset phrase (`upset`, `good faith estimate`, `estimated bid`, `bid amount`), with or without a `$` sign, and SHALL be coerced as money. A figure that follows only a judgment phrase SHALL NOT be taken. When no source holds such a figure, `upsetAmount` SHALL be NULL without a warning. `Property Details` SHALL be read as an upset source and SHALL NOT produce an unknown-field warning.

When the upset row has text that money coercion rejects, the row's own text SHALL be read first, the same way, then the free text in the order above. A warning naming `upsetAmount` and the row's full value SHALL be recorded either way. When none of them holds a figure, `upsetAmount` SHALL be NULL.

#### Scenario: Upset in Property Details

- **WHEN** a Hunterdon page has no upset row and `Property Details` is `APPROX. UPSET: $1,108,438.48`
- **THEN** `upsetAmount` is `1108438.48`, and no warning names `propertyDetails`

#### Scenario: Phrase before the amount without a dollar sign

- **WHEN** `Property Details` is `UPSET AMOUNT: THE AMOUNT OF THE FINAL FORECLOSURE JUDGEMNET THAT MUCH BE SATISFIED BY THIS SALE IS 1,668,737.41, TOGETHER WITH COST OF THE SALE`
- **THEN** `upsetAmount` is `1668737.41`

#### Scenario: Good faith estimate in Description

- **WHEN** a Burlington page has no upset row and `Description` is `APPROXIMATE GOOD FAITH ESTIMATE OF UPSET PRICE: $143,198.00`
- **THEN** `upsetAmount` is `143198`

#### Scenario: Judgment figure only

- **WHEN** a page has no upset row and its only dollar figure in `Description` follows `the approximate amount of the judgment to be satisfied`
- **THEN** `upsetAmount` is NULL, and `judgment` is unaffected

#### Scenario: Upset row wins

- **WHEN** a page has `Upset Amount: $41,000.00` and `Description` mentions an upset price of `$45,000.00`
- **THEN** `upsetAmount` is `41000`

#### Scenario: Upset row states its amount after the phrase

- **WHEN** a Hudson page's upset row is `ESTIMATED UPSET BID AMOUNT: $224,000.00, PLUS ANY ADDITIONAL SUMS AS ORDERED BY THE COURT.` and its `Description` doesn't repeat it
- **THEN** `upsetAmount` is `224000`, and a warning names `upsetAmount` and the full row value

#### Scenario: Upset row with no figure

- **WHEN** a page's upset row is `COMMERCIAL PROPERTY - UPSET NOT NEEDED`, and no upset phrase in its free text is followed by a figure
- **THEN** `upsetAmount` is NULL, and a warning names `upsetAmount` and the row value

#### Scenario: Blank free text

- **WHEN** a page has no upset row and `Property Details`, `Property Note` and `Description` are empty
- **THEN** `upsetAmount` is NULL, and no warning is recorded for it

## MODIFIED Requirements

### Requirement: Money coercion

`upsetAmount` and `judgment` SHALL be coerced from the site's `$D,DDD.DD` text to a number, after stripping `$`, commas and whitespace (including `\r`). `$0.00` SHALL become `0`. A value that is empty or whitespace-only SHALL become NULL without a warning. A value that starts with a dollar amount followed by other text SHALL become that leading amount, with a warning naming the field and the full value. Any other value that isn't a non-negative decimal with at most two fraction digits SHALL become NULL with a warning, except that an `upsetAmount` SHALL be taken from text per "Upset amount from free text" when that finds a figure.

#### Scenario: Dirty money string

- **WHEN** `judgment` is `"\r $1,002,812.05                    "`
- **THEN** it is stored as `1002812.05`

#### Scenario: Zero amount

- **WHEN** `upsetAmount` is `$0.00`
- **THEN** it is stored as `0`, not NULL

#### Scenario: Whitespace-only amount

- **WHEN** `upsetAmount` is `"\r                     "`
- **THEN** it is stored as NULL and no warning is recorded

#### Scenario: Amount followed by text

- **WHEN** `upsetAmount` is `$384,211.73 GOOD THROUGH JULY 19, 2024, AND ANY ADDITIONAL SUMS AS ORDERED BY THE COURT.`
- **THEN** it is stored as `384211.73`, and a warning names `upsetAmount` and the full value

#### Scenario: No leading amount

- **WHEN** `upsetAmount` is `TBD`
- **THEN** it is stored as NULL, and a warning names `upsetAmount`

### Requirement: Unknown fields are dropped

A detail-table key that doesn't map to a known listing field SHALL NOT be passed to the database insert, and SHALL produce a warning naming the key. The expected labels `Property Note` and `Property Details`, read only as upset sources, and `Attorney File`, which Middlesex and Cape May publish blank, SHALL be dropped without a warning.

#### Scenario: New row on the site

- **WHEN** the detail table has a `Township` row that the scraper doesn't know
- **THEN** the saved listing has no `township` property, and a warning names `township`

#### Scenario: Blank Attorney File row

- **WHEN** a Middlesex or Cape May details page has an `Attorney File #` row
- **THEN** the saved listing has no `attorneyFile` property, and no warning names `attorneyFile`

## REMOVED Requirements

### Requirement: Only a missing address rejects a listing

**Reason**: A blank address row dropped 229 archived pages whose sheriff number and amounts were good, including every Middlesex and Cape May page before the `Property Address` mapping. The address isn't part of the listing's identity, which is county and sheriff number.

**Migration**: Replaced by "A missing address does not reject a listing". The split address columns are already nullable; `Listing.address` kept a Prisma-era NOT NULL in prod, which `0013_drop_listing_address_not_null.sql` drops; readers of a listing must handle a NULL address.
