## MODIFIED Requirements

### Requirement: Listing details parsing

The scraper SHALL parse listing details from the `sale-detail-item` label/value layout. It SHALL map labels to listing fields through `cleanPropertyKey`, log and drop labels that aren't listing fields, decode HTML entities in values, collapse whitespace, and keep the address's line break between the street and the city line. `cleanPropertyKey` SHALL map both `Address` and `Property Address` to `address`, and `Minimum Bid` to `upsetAmount`. If the page has no `sale-detail-item` elements, parsing SHALL throw an error saying the layout wasn't recognised.

#### Scenario: Current layout

- **WHEN** a details page shows Sheriff #, Court Case #, Sales Date, Plaintiff, Defendant, Address, Description, Approx. Upset*, Attorney and Parcel # as `sale-detail-item` pairs
- **THEN** the result has `sheriffId`, `courtCase`, `saleDate`, `plaintiff`, `defendant`, `address`, `description`, `upsetAmount`, `attorney` and `parcel` set to the values' decoded, trimmed text

#### Scenario: County labels the address Property Address

- **WHEN** a Middlesex or Cape May details page shows `Property Address: 40 EISENHOWER DRIVE SAYREVILLE NJ 08872`
- **THEN** the result's `address` is `40 EISENHOWER DRIVE SAYREVILLE NJ 08872`, and the listing is not rejected for a missing address

#### Scenario: County shows a minimum bid

- **WHEN** a Cape May details page shows `Minimum Bid: $380,000.00` and no upset label
- **THEN** the value is stored as `upsetAmount`

#### Scenario: County shows judgment instead of upset

- **WHEN** a details page shows `Approximate Judgment` and no upset label
- **THEN** the value is stored as `judgment`

#### Scenario: Unknown label

- **WHEN** a details page shows a label that isn't a listing field, such as `Township`
- **THEN** the label is logged and left out of the result, and the other fields still parse

#### Scenario: Expected label that isn't a listing field

- **WHEN** a Middlesex or Cape May details page shows a blank `Attorney File #`
- **THEN** the label is left out of the result without being logged

#### Scenario: Unrecognised page

- **WHEN** the HTML has no `sale-detail-item` elements, such as the site's home page
- **THEN** parsing throws an error saying the listing details layout wasn't recognised
