## Context

The repo is an npm-workspaces monorepo (`backend`, `frontend`, `packages/database`, `packages/tsconfig`) built with turbo and linted, formatted and packed with Vite+ 1.3.0. Node 24 comes from `mise.toml`, and the scraper Lambda runs `nodejs24.x`. PR #25 moved the backend into `backend/src/modules/sheriffSale/` (stage folders `scrape/`, `parse/`, `ingest/`, plus `replay/` and the handlers) and `backend/src/shared/`. It did not change the dependency set.

Current state, from the explore session and confirmed against a16a48f:

| Area            | Today                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root devDeps    | `@types/node` 24.19.2, `dotenv` 16.4.5, `esbuild` 0.21.5, `tsx` 4.15.7, `turbo` 2.0.5, `typescript` 5.5.2, `vite-plus` 1.3.0                                            |
| Backend runtime | `@aws-sdk/client-s3` 3.379.1, `axios` 1.7.2, `lodash`, `luxon` 2.5.2, `node-html-parser` 5.1.0, `reflect-metadata`, `zod` 4.6.5                                         |
| Backend tests   | Jest 29 + `ts-jest`, `jsdom` environment, `backend/jest.config.js`; 22 files, 226 tests                                                                                 |
| Database        | `drizzle-orm` 0.45.3, `postgres` 3.4.4, `drizzle-kit` 0.31.11, unused `pg` and `rimraf`, `dotenv` misfiled as a devDependency                                           |
| tsconfig        | `base.json` sets `moduleResolution: "node"`; `nextjs.json` sets `target: "es5"`; `node24.json` `module: "ES6"`; `lambda.json` `module: "CommonJS"` plus decorator flags |

Constraints:

- **The frontend is out of scope.** It will be rebuilt on a different stack. It still consumes the root `typescript` and `@types/node`, `@sheriff-sale/tsconfig` (`nextjs.json` → `base.json`) and `@sheriff-sale/database`'s emitted `.d.ts`. So `npm run build` (turbo, which runs `next build`) must stay green, and no frontend dependency is upgraded. The one allowed frontend edit is pinning `typescript` 5.5.2 in `frontend/package.json`.
- Every phase ends with `vp check`, `npm run build` and `npm run test` green, and is committed on its own.

## Goals / Non-Goals

**Goals:**

- Manifests that say exactly what each workspace uses (see the `workspace-dependencies` spec).
- Latest releases for the backend runtime and tooling, within the version decisions below.
- One toolchain for lint, format, pack and test (Vite+).
- TypeScript 7 if it works today, otherwise TypeScript 6 with a recorded reason.

**Non-Goals:**

- Any frontend dependency upgrade or source change, including the issues noted for the frontend effort (tRPC v9 `useQuery` call, unused `react-query` v3 and devtools, dead `createEmotionCache.ts`, `react-table` v7's React ≤18 peer).
- drizzle 1.0, `@types/node` 26, or any Node runtime change.
- Behavior changes to the scraper, parse output, database writes or S3 keys.
- CI workflow changes.

## Decisions

### D1. Phase order P0 → P5, one commit per phase

The phases go hygiene (P0), low-risk bumps (P1), Jest → `vp test` (P2), backend majors (P3, one commit per package), TypeScript 6 (P4), and TypeScript 7 (P5, gated). Hygiene comes first so every later diff runs against a clean, correctly declared baseline. Jest goes before TypeScript because `ts-jest` peers `typescript <7`. The risky runtime change (node-html-parser) gets its own commit, so it can be bisected and reverted alone.

_Alternative:_ one big bump. Rejected, because a failing fixture test would not point at a package.

### D2. Jest → Vitest through `vp test`

Vite+ 1.3.0 bundles Vitest, so this adds no dependency and puts testing on the same tool as lint, format and pack. The test script is `vp test run`, because plain `vp test` watches when attached to a TTY. Tests import their APIs explicitly, not through `globals: true`, so `tsc --noEmit` type-checks them without ambient Vitest types. The root lint rule `vite-plus/prefer-vite-plus-imports` decides the import specifier (`vite-plus/test` rather than `vitest`, to be confirmed in P2). `jest.*` becomes `vi.*`, and `jest.Mock` becomes `Mock`.

`restoreAllMocks` differs between the runners. In Jest it also resets every `jest.fn()`. In Vitest 3 and later it restores only `vi.spyOn` spies. Each file that calls it (`parse/parseListingSnapshot.test.ts`, `scrape/getListingDetailsHtml.test.ts`, `scrape/newJerseySheriffSaleHttpClient.test.ts`) is checked, and gets `vi.resetAllMocks()` where call counts or implementations would otherwise leak between tests. Vitest's defaults (node environment, `**/*.test.ts`) match the backend, so no backend config file is added unless the run shows one is needed. The `jsdom` environment is dropped, because nothing in the backend touches the DOM.

_Alternatives:_ upgrade Jest 30 + `ts-jest` (still blocks TS 7, and keeps a second toolchain), or standalone `vitest` (a duplicate of what Vite+ already ships).

### D3. Drop lodash with a local `camelCase`, after pinning behavior

lodash's only use is `camelCase(cleanKey)` at the end of `modules/sheriffSale/parse/cleanPropertyKey.ts`. The trap is that the function has already rewritten some keys to camelCase (`'sheriffId'`, `'upsetAmount'`), and lodash keeps those unchanged because it splits on case boundaries as well as on spaces and punctuation. A whitespace-only replacement would produce `'sheriffid'`, and `listingSchema` would drop the field silently. So:

1. Add `parse/cleanPropertyKey.test.ts` while lodash is still installed. It covers every detail-page label in the fixtures (`__fixtures__/listingDetails*.html`, including the legacy layouts) and the already-camelCased keys.
2. Replace `camelCase` with a small local function: split on non-alphanumerics and on lower→upper boundaries, lowercase the first word, capitalize the rest.
3. Remove `lodash` and `@types/lodash`. The test must pass unchanged.

### D4. Declare dependencies where they are used

`esbuild` (backend `bundle`), `tsx` (backend scripts, database `db:migrate`), `dotenv` and `vite-plus` move into the workspaces that use them. `dotenv` is a `dependency` of `packages/database`, because `src/client.ts` imports it in shipped code, and a devDependency of `backend`, because only `handler.local.ts` and `replay/index.ts` import it and neither is in the Lambda bundle. Root keeps `turbo`, `typescript`, `@types/node` and `vite-plus`. `ts-node` is replaced with `tsx` in `replay:archive` and `start:newJerseyScraper`, and `rimraf` with `rm -rf` in database `clean`, as backend already does. `backend/package-lock.json` is deleted, because it is stale and references the removed `packages/config`.

### D5. Version decisions

- **drizzle**: stay on drizzle-orm 0.45.x and drizzle-kit 0.31.x, because 1.0 is still an RC. P1 moves drizzle-orm to 0.45.4. drizzle-kit 0.31.11 is already the newest on its line, so it stays (see the modified `database-toolchain` requirement).
- **`@types/node`**: stay on 24.x, matching Node 24 and `nodejs24.x`. Do not move to 26.
- **dotenv 18**: v17 and later log a line on every `config()` call by default, so each call passes `quiet: true`.
- **esbuild 0.28**: after the bump, rebuild the bundle and smoke-test it (require `dist/index.js` and check that `handler` is a function).
- **node-html-parser 9**: this is the highest-risk runtime change. It is the scraper's core, and v8 replaced `he` with `entities` for entity decoding. The fixture-driven parse tests are the safety net. A before/after comparison of parsed snapshots from a dry-run `replay:archive` would add confidence, but it needs S3 credentials, so it is skipped if those are unavailable, and the summary says so.
- **P1 targets**, confirmed against `npm view` on 2026-10-17: turbo 2.11.9, tsx 4.23.15, `@aws-sdk/client-s3` 3.1152.0, axios 1.20.0, zod 4.6.7, postgres 3.4.9, drizzle-orm 0.45.4, `@types/luxon` 3.7.6. P3 targets: luxon 3.7.2, dotenv 18.0.8, esbuild 0.28.2, node-html-parser 9.0.4.

### D6. TypeScript 6 with the frontend pinned to 5.5.2

Next 14.2 loads the TypeScript JS API during `next build`. Pinning `"typescript": "5.5.2"` in `frontend/package.json` makes npm nest that version in `frontend/node_modules`, so Next keeps the compiler it builds with today while the root moves on.

TS 6 rejects `moduleResolution: "node"` (node10) and `target: "es5"` as deprecations, and TS 7 removes them. The tsconfig changes:

- Move `moduleResolution: "node"` from `base.json` into `nextjs.json`, so the frontend's effective config is unchanged. `nextjs.json`'s `target: "es5"` is read only by the frontend's TS 5.5.2, so it stays.
- Give `node24.json` and `lambda.json` `module: "preserve"` and `moduleResolution: "bundler"`. Nothing in backend or database is emitted by `tsc`: esbuild bundles the backend, and `vp pack` builds the database.
- Remove `experimentalDecorators` and `emitDecoratorMetadata` from `lambda.json`. They supported `reflect-metadata`, which P0 removes.
- Fix any TS 6 default changes the build reports (for example, `types` defaulting to `[]`, which would hide `@types/node` globals) by setting the option explicitly in the shared config, not with `ignoreDeprecations`.

Then confirm that `tsc --noEmit` passes for backend and database, and that `vp pack` still emits `.d.cts`/`.d.mts` that the frontend's `next build` type-checks against.

_Alternative:_ `ignoreDeprecations: "6.0"`. Rejected, because it only defers the work to TS 7, which removes the options outright.

### D7. TypeScript 7 is gated on a spike

TS 7.0 (the native port) ships without the JS compiler API, which is expected in 7.1. The spike checks two things on 7.0.2: whether `vp pack` with `dts: true` emits declarations (it probably goes through the compiler API), and whether backend `tsc --noEmit` passes. If both pass, 7.0.2 lands at root. If either fails, the root stays on 6.0.3, the failure is recorded below under "TypeScript 7 spike result", and the upgrade is revisited when TS 7.1 ships the API. The frontend keeps its pinned 5.5.2 either way.

### TypeScript 7 spike result

_To be filled in during P5._

## Implementation notes

Things the plan did not anticipate, recorded as each phase landed.

- **P0.** `cleanPropertyKey`'s local `camelCase` tokenizes with `/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g`, the same word split lodash uses for ASCII input. The new test has 28 cases (every fixture label, the already-camelCased keys, and a few edge cases), and it passed both before and after lodash was removed.
- **P1.** Two typing changes surfaced. axios 1.20 types instance methods as `Promise<AxiosResponseResult<T, R, …>>`, a conditional type that TS cannot narrow to the wrapper's generic `R`. So `shared/http/httpClient.ts` passes `<T, R>` (or `<T, R, B>`) through and asserts `as Promise<R>`; runtime behavior is unchanged. `@types/luxon` 3.7 types `toISODate()` as `string | null` on a `DateTime` that may be invalid, so `replay/args.ts`'s `parseDate` returns `DateTime<true>`, which it already guarantees by throwing on invalid input.
- **P2.** No backend Vitest config was needed: the defaults (node environment, `**/*.test.ts`) find the same 23 files, and every test passed unchanged after the mechanical `jest.*` → `vi.*` rewrite. None of the three `restoreAllMocks` files needed `vi.resetAllMocks()`. Two of them already call `mockReset()` on their only `vi.fn()` (the mocked `saveHtmlToS3`), and `parseListingSnapshot.test.ts` uses only a `console` spy. Part of P4 had to move forward: TS can't resolve the `vite-plus/test` subpath export under `moduleResolution: "node"` (node10 ignores `exports`), so `lambda.json` moved to `module: "preserve"` / `moduleResolution: "bundler"` in P2. TS 5.5 supports both. node-html-parser 5.1.0's `exports` map gives its `import` condition no types, so `lambda.json` also gets a temporary `customConditions: ["require"]` until P3 moves it to 9.x, which ships typed `exports`. `node16` resolution was rejected, because it would need a `.js` extension on `replay/index.ts`'s dynamic import. The esbuild bundle is byte-identical with the old and new tsconfig.

## Risks / Trade-offs

- [node-html-parser 9 decodes entities differently (`entities` instead of `he`)] → Fixture tests cover the current and legacy detail layouts and county listings. If a fixture shifts, compare the decoded text and fix it in `parse/detailValueText.ts` rather than updating the expectation blindly. The `replay:archive` comparison is optional and needs S3.
- [Mock leakage after `restoreAllMocks`] → Audit the three files that call it, and add `vi.resetAllMocks()` where needed. The P2 test count must match P1's.
- [The local `camelCase` drifts from lodash on an unseen label] → The new test pins every fixture label with lodash installed. `listingSchema` would drop an unknown key, so a missed label shows up as a missing field in the parse tests.
- [The frontend picks up the root TS through hoisting] → Verify `require('typescript').version` from `frontend/` is 5.5.2 after `npm install`, and that `next build` passes.
- [`module: "preserve"` changes how `__dirname` and `import` are type-checked in Node scripts] → Backend and database are type-checked only (`noEmit`) or bundled. `tsx` runs the scripts as CommonJS, because no workspace sets `"type": "module"`, so `__dirname` still works at runtime.
- [`vite` override drift] → `overrides.vite` stays at `@voidzero-dev/vite-plus-core@1.3.0`, because vite-plus stays at 1.3.0 (the newest).
- [The unarchived `migrate-lint-format-to-vite-plus` change says "the backend Jest suite passes"] → It is complete but not archived, so this change cannot modify it. When it is archived, `vite-plus-toolchain`'s "Consumers build against the packed output" scenario should read "the backend `vp test` suite"; this change's `workspace-dependencies` spec states the new runner.

## Migration Plan

Each phase is its own commit on `upgrade-backend-dependencies`, with `vp check`, `npm run build` and `npm run test` green at each. Rollback is reverting the phase's commit and running `npm ci`. Deploys are unchanged: CI builds the same `backend/dist/index.js` bundle, and the Lambda contract (entry, `handler` export, env vars) does not move.

## Open Questions

- Whether `vite-plus/prefer-vite-plus-imports` wants `vite-plus/test` or accepts `vitest`. Resolved in P2 by running `vp lint`.
- Whether TS 7.0.2 passes the P5 spike. Resolved in P5 and recorded above.
