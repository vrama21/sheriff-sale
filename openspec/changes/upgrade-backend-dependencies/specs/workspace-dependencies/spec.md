## ADDED Requirements

### Requirement: One lockfile

The repository SHALL have exactly one npm lockfile, the root `package-lock.json`. No workspace SHALL contain its own `package-lock.json`. `npm ci` at the root SHALL install every workspace.

#### Scenario: No workspace lockfile

- **WHEN** the repository (excluding `node_modules`) is searched for `package-lock.json`
- **THEN** only the root `package-lock.json` is found

#### Scenario: Clean install

- **WHEN** `npm ci` runs at the root on Node 24
- **THEN** it exits 0 without modifying `package-lock.json`

### Requirement: Workspaces declare what they use

Each of `backend` and `packages/database` SHALL declare, in its own `package.json`, every package its sources import and every package binary its scripts run, other than the root-level tooling (`turbo`, `typescript`). A package imported at runtime by code that ships in the workspace's build output SHALL be a `dependency`. A package used only by scripts, tests, local runners or config files SHALL be a `devDependency`. The root `package.json` SHALL declare only `turbo`, `typescript`, `@types/node` and `vite-plus`.

#### Scenario: Backend declares its tools

- **WHEN** `backend/package.json` is read
- **THEN** `esbuild`, `tsx`, `dotenv` and `vite-plus` are among its `devDependencies`

#### Scenario: Database declares its runtime and tools

- **WHEN** `packages/database/package.json` is read
- **THEN** `dotenv`, `drizzle-orm` and `postgres` are `dependencies`, and `tsx`, `drizzle-kit` and `vite-plus` are `devDependencies`

#### Scenario: Root keeps only shared tooling

- **WHEN** the root `package.json` is read
- **THEN** its `devDependencies` are exactly `turbo`, `typescript`, `@types/node` and `vite-plus`, and it has no `dependencies`

### Requirement: No unused packages

`backend` and `packages/database` SHALL NOT declare a package that nothing in the workspace imports, runs or loads through configuration. In particular, `backend` SHALL NOT declare `lodash`, `@types/lodash`, `reflect-metadata`, `csv-parse`, `@types/mocha`, `@types/aws-lambda`, `jsdom`, `jest-environment-jsdom` or `ts-node`, and `packages/database` SHALL NOT declare `pg` or `rimraf`.

#### Scenario: Removed packages stay removed

- **WHEN** `backend/package.json` and `packages/database/package.json` are read
- **THEN** none of the packages named in this requirement appears in either

#### Scenario: Scripts run on tsx

- **WHEN** `npm run replay:archive -- --help` runs in `backend`
- **THEN** it starts through `tsx` and prints the replay usage, without `ts-node` installed

### Requirement: Exact pins

Every dependency in the root, `backend` and `packages/database` manifests SHALL be pinned to an exact version, with no `^`, `~` or range, except workspace references (`"*"`) to `@sheriff-sale/*` packages. The root `overrides.vite` SHALL name the `@voidzero-dev/vite-plus-core` version equal to the pinned `vite-plus` version.

#### Scenario: No ranges

- **WHEN** the dependency maps of the root, `backend` and `packages/database` manifests are read
- **THEN** every version that is not `"*"` is an exact semver version

#### Scenario: Vite override in lockstep

- **WHEN** the root `package.json` is read
- **THEN** `overrides.vite` is `npm:@voidzero-dev/vite-plus-core@<v>`, where `<v>` is every workspace's `vite-plus` version

### Requirement: Backend tests run on Vite+

The backend test suite SHALL run on the Vitest bundled with Vite+, through a `test` script that runs `vp test run`. Test files SHALL import their test APIs explicitly (no globals) from the entry point the root lint rule `vite-plus/prefer-vite-plus-imports` accepts. `backend` SHALL NOT depend on `jest`, `ts-jest` or `@types/jest`, and SHALL NOT contain a Jest config. `tsc --noEmit` in the backend `build` script SHALL type-check the test files.

#### Scenario: Suite passes under vp test

- **WHEN** `npm run test` runs at the root
- **THEN** turbo runs the backend `test` script, `vp test run` runs every `backend/src/**/*.test.ts` file once and exits 0, and the number of passing tests is no lower than before the migration (plus any tests this change adds)

#### Scenario: No Jest left

- **WHEN** `backend/` (excluding `node_modules`) is searched for `jest.config.*` and for `jest.` in `*.ts` files
- **THEN** nothing is found

#### Scenario: Tests are type-checked

- **WHEN** a backend test file contains a type error
- **THEN** `npm run build` in `backend` fails at `tsc --noEmit`

### Requirement: TypeScript versions

The root `package.json` SHALL pin `typescript` to an exact 6.x or 7.x version, which `backend` and `packages/database` build with. `frontend/package.json` SHALL pin its own `typescript` to `5.5.2` as a devDependency, so `next build` keeps the compiler and JS API it builds with today. The shared tsconfig files SHALL contain no option the root TypeScript version reports as deprecated or removed. `moduleResolution: "node"` SHALL appear only in `nextjs.json`. `node24.json` and `lambda.json` SHALL use `module: "preserve"` and `moduleResolution: "bundler"`, and SHALL NOT enable `experimentalDecorators` or `emitDecoratorMetadata`.

#### Scenario: Backend and database build on the root compiler

- **WHEN** `npm run build` runs at the root
- **THEN** backend `tsc --noEmit` and the esbuild bundle succeed, `packages/database`'s `vp pack` emits `.d.cts` and `.d.mts` declarations, and `frontend`'s `next build` succeeds against those declarations

#### Scenario: Frontend keeps its compiler

- **WHEN** `require('typescript').version` is evaluated from `frontend/`
- **THEN** it is `5.5.2`, while from the root it is the root's pinned version

#### Scenario: No deprecation errors

- **WHEN** `tsc --noEmit -p backend` runs on the root TypeScript version
- **THEN** it reports no deprecated-option error and needs no `ignoreDeprecations` setting
