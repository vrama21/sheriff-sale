Every phase ends with the gate: `vp check`, `npm run build` and `npm run test` at the root, all green. Then the phase is committed on its own. Do not upgrade any frontend dependency. The only frontend edit is the `typescript` pin in 5.1.

## 1. P0 Hygiene

- [x] 1.1 Run `npm ci` at the root (the copied `node_modules` was stale), delete the stale `packages/config` copy if present, and record the baseline: gate green, backend test count
- [x] 1.2 Delete `backend/package-lock.json`
- [x] 1.3 Remove the unused backend packages `reflect-metadata`, `csv-parse`, `@types/mocha`, `@types/aws-lambda`, `jsdom` and `jest-environment-jsdom`. Set `testEnvironment: 'node'` in `backend/jest.config.js`
- [x] 1.4 Replace `ts-node` with `tsx` in the backend `replay:archive` and `start:newJerseyScraper` scripts, and remove `ts-node`
- [x] 1.5 Remove `pg` and `rimraf` from `packages/database`, and change its `clean` script to `rm -rf .turbo node_modules dist`
- [x] 1.6 Move `esbuild` and `tsx` from root to `backend` devDependencies. Move `tsx` to `packages/database` devDependencies, and add `vite-plus` to `backend` devDependencies
- [x] 1.7 Move `dotenv` from root to `backend` devDependencies, and from `packages/database` devDependencies to its `dependencies`. Root keeps only `turbo`, `typescript`, `@types/node` and `vite-plus`
- [x] 1.8 Add `backend/src/modules/sheriffSale/parse/cleanPropertyKey.test.ts` covering every detail-page label in `__fixtures__/listingDetails*.html` (current and legacy layouts) plus the already-camelCased keys (`sheriffId`, `upsetAmount`, `saleDate`). Run it with lodash still installed and confirm it passes
- [x] 1.9 Replace lodash `camelCase` in `parse/cleanPropertyKey.ts` with a local function (split on non-alphanumerics and lower→upper boundaries, lowercase the first word, capitalize the rest), and confirm the 1.8 test passes unchanged
- [x] 1.10 Remove `lodash` and `@types/lodash` from `backend`
- [x] 1.11 Run `npm install` to refresh the lockfile, then confirm `npm ci` succeeds, `npm run replay:archive -- --help` runs through `tsx`, and the gate is green. Commit P0

## 2. P1 Low-risk bumps

- [x] 2.1 Re-check `npm view` for anything newer, then bump turbo 2.11.9 (root), tsx 4.23.15 (backend, database), `@aws-sdk/client-s3` 3.1152.0, axios 1.20.0, zod 4.6.7 and `@types/luxon` 3.7.6 (backend), and postgres 3.4.9 and drizzle-orm 0.45.4 (database). drizzle-kit stays 0.31.11
- [x] 2.2 Confirm `DATABASE_URL=postgres://localhost/unused npm run db:generate` in `packages/database` reports no schema changes and adds no migration
- [x] 2.3 Run the gate and commit P1

## 3. P2 Jest → vp test

- [ ] 3.1 Confirm which import specifier `vite-plus/prefer-vite-plus-imports` accepts for test APIs (`vite-plus/test` or `vitest`)
- [ ] 3.2 Convert the nine test files that use `jest.*` (`shared/s3/getS3Text.test.ts`, and under `modules/sheriffSale/`: `handler.test.ts`, `pipeline.test.ts`, `ingest/syncListing.test.ts`, `parse/parseListingSnapshot.test.ts`, `replay/replay.test.ts`, `scrape/saveHtmlToS3.test.ts`, `scrape/getListingDetailsHtml.test.ts`, `scrape/newJerseySheriffSaleHttpClient.test.ts`): `jest.*` → `vi.*`, `jest.Mock` → `Mock`, hoisting-safe `vi.mock` factories
- [ ] 3.3 Add explicit test-API imports (`describe`, `it`, `expect`, …) to every backend `*.test.ts`, with no `globals: true`
- [ ] 3.4 Audit the `restoreAllMocks` calls in `parse/parseListingSnapshot.test.ts`, `scrape/getListingDetailsHtml.test.ts` and `scrape/newJerseySheriffSaleHttpClient.test.ts`, and add `vi.resetAllMocks()` where `vi.fn()` state would leak between tests
- [ ] 3.5 Set the backend `test` script to `vp test run`. Remove `jest`, `ts-jest`, `@types/jest` and `backend/jest.config.js`. Add a backend `vite.config.ts` only if Vitest's defaults (node environment, `**/*.test.ts`) are not enough
- [ ] 3.6 Confirm `tsc --noEmit` in backend type-checks the tests, that the passing test count equals P1's, and that no `jest` reference remains in `backend/`. Run the gate and commit P2

## 4. P3 Backend majors (one commit each)

- [ ] 4.1 luxon 2.5.2 → 3.7.2. Check the call sites in `parse/listingSchema.ts`, `scrape/saveHtmlToS3.ts` and `replay/args.ts` against the v3 changelog. Run the gate and commit
- [ ] 4.2 dotenv → 18.0.8 in `backend` and `packages/database`. Pass `quiet: true` to every `config()` call (`modules/sheriffSale/handler.local.ts`, `modules/sheriffSale/replay/index.ts`, `packages/database/drizzle.config.ts`, `packages/database/src/client.ts`, `packages/database/src/migrate.ts`). Run the gate and commit
- [ ] 4.3 esbuild 0.21.5 → 0.28.2. Rebuild the bundle and smoke-test that `require('./backend/dist/index.js').handler` is a function. Run the gate and commit
- [ ] 4.4 node-html-parser 5.1.0 → 9.0.4. Check the call sites in `parse/` (`detailValueText.ts`, `parseListingDetails.ts`, `parseLegacyListingDetails.ts`, `parseStatusHistory.ts`, `parseListingSnapshot.ts`, `parseCountyPropertyIds.ts`) against the v6–v9 changelogs (v8 replaced `he` with `entities`). The fixture tests must pass with no expectation changes
- [ ] 4.5 If S3 credentials are available, compare parsed snapshots from a dry-run `replay:archive` before and after the node-html-parser bump. Otherwise skip it and say so in the summary
- [ ] 4.6 Run the gate and commit the node-html-parser bump

## 5. P4 TypeScript 6.0.3

- [ ] 5.1 Pin `"typescript": "5.5.2"` in `frontend/package.json` devDependencies, and confirm `require('typescript').version` from `frontend/` is 5.5.2 after install
- [ ] 5.2 Bump the root `typescript` to 6.0.3
- [ ] 5.3 Move `moduleResolution: "node"` from `packages/tsconfig/base.json` into `nextjs.json`
- [ ] 5.4 Set `module: "preserve"` and `moduleResolution: "bundler"` in `node24.json` and `lambda.json`. Remove `experimentalDecorators` and `emitDecoratorMetadata` from `lambda.json`
- [ ] 5.5 Fix any other TS 6 deprecation or default-change errors in the shared configs (no `ignoreDeprecations`)
- [ ] 5.6 Confirm backend and database `tsc --noEmit` pass, and that `vp pack` emits `.d.cts`/`.d.mts` that the frontend's `next build` reads. Run the gate and commit P4

## 6. P5 TypeScript 7.0.2 (gated)

- [ ] 6.1 Spike: with the root `typescript` at 7.0.2, check whether `vp pack` (`dts: true`) emits declarations and backend `tsc --noEmit` passes
- [ ] 6.2 If the spike passes, land 7.0.2 at root. If not, revert to 6.0.3 and record why under "TypeScript 7 spike result" in `design.md`. The frontend stays on 5.5.2 either way
- [ ] 6.3 Run the gate and commit P5

## 7. Wrap-up

- [ ] 7.1 Verify the `workspace-dependencies` scenarios: one lockfile, the root devDependencies set, the removed packages, exact pins, `overrides.vite` in lockstep
- [ ] 7.2 Run `openspec validate upgrade-backend-dependencies --strict`
