## MODIFIED Requirements

### Requirement: Pinned Drizzle versions

`packages/database/package.json` SHALL pin `drizzle-orm` and `drizzle-kit` to exact versions, with no range operators. `drizzle-orm` SHALL be 0.41.0 or later, so that `numeric` columns support `mode: 'number'`, and SHALL stay below 1.0 until a stable 1.0 is released. The two packages SHALL be a matched pair: when one is upgraded, the other SHALL be moved in the same change to the newest release on its current minor line, or left unchanged if it is already the newest.

#### Scenario: Exact pins

- **WHEN** `packages/database/package.json` is read
- **THEN** `drizzle-orm` is `0.45.4` and `drizzle-kit` is `0.31.11`, with no `^` or `~`

#### Scenario: Numeric number mode type-checks

- **WHEN** a column is declared as `numeric('x', { precision: 12, scale: 2, mode: 'number' })`
- **THEN** `typeof table.$inferSelect['x']` is `number | null` and `tsc --noEmit` passes

### Requirement: Consumers build against the upgraded ORM

The `backend`, `frontend` and `packages/database` workspaces SHALL type-check, build, test and lint against the upgraded `drizzle-orm`, with no change to the SQL their queries produce.

#### Scenario: Workspace gates pass

- **WHEN** `npm run build` and `npm run test` run at the repo root, and `npm run lint` runs in `backend`, `frontend` and `packages/database`
- **THEN** all of them pass

#### Scenario: Listing sync keeps its shape

- **WHEN** the backend's `syncListing` tests run under `vp test` with `@sheriff-sale/database` mocked
- **THEN** they pass with no change to the database calls they assert
