## MODIFIED Requirements

### Requirement: Lambda bundle build

The `backend` workspace `build` script SHALL type-check the sources and SHALL use esbuild to bundle `src/modules/sheriffSale/handler.ts` into `backend/dist/index.js`. The bundle SHALL be a single CommonJS file targeting Node 24 with `@aws-sdk/*` included. The bundle SHALL export `handler`. The build SHALL NOT require AWS credentials, `DATABASE_URL`, or `ENV`.

#### Scenario: Build on a feature branch

- **WHEN** the CI `build` job runs on a non-main branch with placeholder secrets
- **THEN** `npm run build` succeeds and `backend/dist/index.js` exists

#### Scenario: Handler export

- **WHEN** `backend/dist/index.js` is required in Node 24
- **THEN** it exposes a `handler` function
