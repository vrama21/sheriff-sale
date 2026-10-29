## MODIFIED Requirements

### Requirement: Lambda bundle build

The `backend` workspace `build` script SHALL type-check the sources and SHALL use esbuild to bundle:

- `src/modules/sheriffSale/handler.ts` into `backend/dist/index.js`;
- `src/modules/clerkRecords/handler.ts` into `backend/dist/clerkRecords/index.js`;
- `src/modules/njParcels/handler.ts` into `backend/dist/njParcels/index.js`.

Each bundle SHALL be a single CommonJS file targeting Node 24 with `@aws-sdk/*` included. Each bundle SHALL export `handler`. The build SHALL NOT require AWS credentials, `DATABASE_URL`, or `ENV`.

#### Scenario: Build on a feature branch

- **WHEN** the CI `build` job runs on a non-main branch with placeholder secrets
- **THEN** `npm run build` succeeds, and `backend/dist/index.js`, `backend/dist/clerkRecords/index.js` and `backend/dist/njParcels/index.js` exist

#### Scenario: Handler export

- **WHEN** any of the three bundles is required in Node 24
- **THEN** it exposes a `handler` function

#### Scenario: Bundles stay separate

- **WHEN** `backend/dist/index.js` is inspected
- **THEN** it contains no code from `src/modules/clerkRecords/` or `src/modules/njParcels/`
