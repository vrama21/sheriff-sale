## Why

The backend and its shared tooling have drifted well behind upstream, and the dependency set no longer describes what the code uses:

- **Unused packages ship in the manifests.** `reflect-metadata`, `csv-parse`, `@types/mocha`, `@types/aws-lambda`, `jsdom`, `jest-environment-jsdom` and `ts-node` in `backend`, and `pg` and `rimraf` in `packages/database`, are never imported or run.
- **Used packages are undeclared.** `esbuild`, `tsx`, `dotenv` and `vite-plus` resolve in `backend` (and `tsx` in `packages/database`) only because npm hoists them from the root. `packages/database` imports `dotenv` at runtime but lists it as a devDependency.
- **A second, stale lockfile.** `backend/package-lock.json` still references the deleted `packages/config`.
- **Majors are pinned behind.** TypeScript 5.5, luxon 2, dotenv 16, esbuild 0.21, node-html-parser 5 and Jest 29 (whose `ts-jest` peers `typescript <7`) block moving the toolchain forward. `lodash` is pulled in for one `camelCase` call.

Vite+ 1.3.0 already ships Vitest, so the test runner can join `vp lint`, `vp fmt` and `vp pack` under one tool. Doing the upgrade now, while the frontend is about to be replaced, means only the backend, the database package and the shared tooling need to move. The frontend only has to keep building.

## What Changes

- **P0 hygiene.** Run `npm ci` and delete `backend/package-lock.json`. Remove the unused packages listed above. Declare `esbuild`, `tsx`, `dotenv` and `vite-plus` in the workspaces that use them, which leaves root with only `turbo`, `typescript`, `@types/node` and `vite-plus`. Switch `replay:archive` and `start:newJerseyScraper` from `ts-node` to `tsx`, and `packages/database`'s `clean` from `rimraf` to `rm -rf`. Replace lodash's `camelCase` in `cleanPropertyKey` with a local function, after a new test pins the current behavior with lodash still installed.
- **P1 low-risk bumps** (one commit): turbo, tsx, `@aws-sdk/client-s3`, axios, zod (backend), postgres, drizzle-orm (0.45.x) and `@types/luxon`.
- **P2 Jest → `vp test`.** Remove `jest`, `ts-jest`, `@types/jest` and `backend/jest.config.js`. Backend tests run on Vitest through `vp test run`, with explicit imports. `tsc --noEmit` in `build` type-checks the tests.
- **P3 backend majors** (one commit each): luxon 3, dotenv 18 (with `quiet: true`), esbuild 0.28, node-html-parser 9.
- **P4 TypeScript 6.0.3** at root. The frontend pins its own `typescript` 5.5.2. The shared tsconfigs drop the options TS 6 deprecates (`moduleResolution: "node"` moves to `nextjs.json`, where TS 5.5 still reads it), the Node configs move to `module: "preserve"` with `moduleResolution: "bundler"`, and the unused decorator flags are removed from `lambda.json`.
- **P5 TypeScript 7.0.2, gated.** Spike whether `vp pack`'s declaration emit and backend `tsc --noEmit` work on 7.0.2. Land it if they do. If not, stay on 6.0.3 and record why in `design.md`.
- Stay on drizzle-orm 0.45.x and drizzle-kit 0.31.x (1.0 is still an RC). Keep `@types/node` on 24.x, matching the Node 24 runtime.
- **Out of scope:** upgrading any frontend dependency. The only allowed frontend edit is the `typescript` 5.5.2 pin. `npm run build`, which builds the frontend through turbo, must stay green after every phase.

## Capabilities

### New Capabilities

- `workspace-dependencies`: How dependencies are declared across the npm workspaces: one root lockfile, each workspace declaring every package it imports or runs, the root keeping only shared tooling, no unused packages, exact pins, the backend test runner (`vp test`), and the TypeScript version split between the root toolchain and the frontend's pinned compiler.

### Modified Capabilities

- `database-toolchain`: "Pinned Drizzle versions" moves the pinned `drizzle-orm` to 0.45.4, keeps both packages below 1.0, and clarifies the matched-pair rule when drizzle-kit has no newer release on its line. "Consumers build against the upgraded ORM" runs the backend suite under `vp test`.

## Impact

- **Manifests:** root `package.json`, `backend/package.json`, `packages/database/package.json`, `frontend/package.json` (the `typescript` pin only), and `package-lock.json`. `backend/package-lock.json` is deleted.
- **Config:** `backend/jest.config.js` is deleted. `packages/tsconfig/{base,nextjs,node24,lambda}.json` change. A backend `vite.config.ts` is added only if Vitest's defaults are not enough.
- **Code:** `backend/src/modules/sheriffSale/parse/cleanPropertyKey.ts` (plus a new test), every backend `*.test.ts` that uses `jest.*` (nine files under `src/modules/sheriffSale/` and `src/shared/s3/`), and the `dotenv` `config()` calls in `backend/src/modules/sheriffSale/{handler.local.ts,replay/index.ts}` and `packages/database/{drizzle.config.ts,src/client.ts,src/migrate.ts}`. The node-html-parser and luxon call sites under `src/modules/sheriffSale/parse/` and `ingest/` change only if their APIs did.
- **Runtime:** the Lambda bundle is rebuilt with esbuild 0.28 and node-html-parser 9. Its entry (`src/modules/sheriffSale/handler.ts`), output (`backend/dist/index.js`) and `handler` export are unchanged.
- **CI:** no workflow change. `npm ci`, `vp check`, `npm run build` and `npm run test` keep their names.
