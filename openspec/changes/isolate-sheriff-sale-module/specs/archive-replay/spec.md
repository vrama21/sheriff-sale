## MODIFIED Requirements

### Requirement: Legacy details parsing

The legacy details parser SHALL read each row of the old layout's details table whose first cell has class `heading-bold`, take that cell's text without the trailing colon as the label and the next cell as the value, and map labels to listing fields the same way as the current parser. Values SHALL be decoded and whitespace-collapsed like the current parser's, with `<br>` kept as a line break in the address. Like the current parser, it SHALL return the values as text, leaving labels that aren't listing fields to listing validation, which drops them with a field warning.

#### Scenario: Legacy page fields

- **WHEN** a legacy page has `Sheriff #: F-24000056`, `Sales Date: 07/15/2024 02:00 PM`, `Approx. Upset*: $275,983.46` and `Address: 263 Three Bridge Road<br/>Monroeville NJ 08343`
- **THEN** the parse has `sheriffId` `F-24000056`, `saleDate` `07/15/2024 02:00 PM`, `upsetAmount` `$275,983.46`, and an address that `parseAddress` splits into street `263 Three Bridge Road`, city `Monroeville` and ZIP `08343`
