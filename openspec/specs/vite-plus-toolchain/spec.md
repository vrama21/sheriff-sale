# vite-plus-toolchain Specification

## Purpose

TBD - created by archiving change migrate-lint-format-to-vite-plus. Update Purpose after archive.

## Requirements

### Requirement: Vite+ is the lint, format and library-pack toolchain

The root `package.json` SHALL declare `vite-plus` as a dev dependency pinned to an exact version (no `^` or `~`). Lint, format and check configuration SHALL live in a single root `vite.config.ts` that exports a static `defineConfig` from `vite-plus`, with `lint` and `fmt` blocks. The only other `vite.config.ts` SHALL be `packages/database/vite.config.ts`, holding only a `pack` block. The repository SHALL NOT contain `.oxlintrc.json`, `.oxfmtrc.json`, `.eslintrc*`, `.eslintignore`, `.prettierrc*`, `.prettierignore` or `tsup.config.*` files outside `node_modules`. Workspace-specific lint differences SHALL be expressed as `lint.overrides` entries keyed by file glob.

#### Scenario: One config file

- **WHEN** the repository (excluding `node_modules`) is searched for ESLint, Prettier, Oxlint, Oxfmt and tsup config files
- **THEN** none are found, the root `vite.config.ts` holds the `lint` and `fmt` configuration, and `packages/database/vite.config.ts` holds only the `pack` configuration

#### Scenario: Pinned Vite+

- **WHEN** the root `package.json` is read
- **THEN** `devDependencies['vite-plus']` is an exact version, and no workspace depends on `eslint`, `prettier`, `tsup`, `@typescript-eslint/*`, `eslint-config-*` or `eslint-plugin-*`

#### Scenario: Shared config package removed

- **WHEN** the workspaces are listed
- **THEN** `packages/config` (`@sheriff-sale/config`) does not exist, and no `package.json` references it

### Requirement: Lint covers every code workspace with equivalent rules

`vp lint` SHALL lint the TypeScript sources of `backend` (`src`, `scripts`), `frontend` (`src`) and `packages/database` (`src`). It SHALL enable Oxlint's correctness rules for JavaScript and TypeScript in all three, and the `react`, `nextjs` and `jsx-a11y` plugins for `frontend/**`. Unused function arguments whose names start with `_` SHALL NOT be reported. `react/jsx-key` and `nextjs/no-html-link-for-pages` SHALL be off for the frontend. Every `eslint-disable` comment left in source SHALL name a rule that exists in the active Oxlint configuration. Each workspace SHALL keep a `lint` script that runs `vp lint`, so that `npm run lint` at the root (through Turbo) lints all three.

#### Scenario: Lint passes

- **WHEN** `vp lint` runs at the repository root on Node 24
- **THEN** it exits 0 with no errors

#### Scenario: Turbo lint still works

- **WHEN** `npm run lint` runs at the root
- **THEN** Turbo runs the `lint` task in `backend`, `frontend` and `packages/database`, each runs `vp lint`, and all succeed

#### Scenario: Underscore arguments are allowed

- **WHEN** a function in any workspace declares an unused parameter named `_event`
- **THEN** `vp lint` reports nothing for it

### Requirement: Format keeps the existing style

`vp fmt` SHALL format TypeScript and TSX across the repository with a print width of 120, single quotes, semicolons, trailing commas everywhere and 2-space indentation. Generated or vendored output (`dist`, `.next`, `.turbo`, `packages/database/drizzle`, lockfiles, `infra/.terraform`) SHALL be excluded. The root `format` script SHALL run `vp fmt`. If the formatter supports Markdown, Markdown files SHALL also be formatted. Otherwise, the gap SHALL be recorded in the change's design.

#### Scenario: Tree is formatted

- **WHEN** `vp fmt --check` runs at the root on Node 24
- **THEN** it exits 0

#### Scenario: Style preserved

- **WHEN** a source file that Prettier with the previous config left unchanged is run through `vp fmt`
- **THEN** it is unchanged, except for documented Oxfmt and Prettier differences

### Requirement: Database package is packed with vp pack

`packages/database` SHALL build with `vp pack` from the `pack` configuration, emitting CommonJS and ESM bundles with type declarations and source maps for `src/index.ts`. The `build` script SHALL keep running `drizzle-kit generate` first through its `prebuild` hook, and `dev` SHALL keep its `predev` hook. The package's `main`, `module` and `types` (and `exports`, if present) SHALL point at files that `vp pack` emits. Any tsdown <0.23 compatibility setting SHALL be kept only if removing it breaks `vp pack` or a consumer build, and the decision SHALL be recorded.

#### Scenario: Pack emits consumable outputs

- **WHEN** `npm run build` runs in `packages/database`
- **THEN** `drizzle-kit generate` runs, `vp pack` succeeds, and every path named by `main`, `module` and `types` exists in `dist`

#### Scenario: Consumers build against the packed output

- **WHEN** `npm run build` runs at the repository root
- **THEN** the database pack, the backend `tsc --noEmit` and esbuild bundle, and the frontend `next build` all succeed, and the backend Jest suite passes

### Requirement: CI enforces the check gate

The CI `build` job SHALL run `vp check` (format check and lint) after installing dependencies and before building, using Node from `mise.toml`. A formatting or lint error SHALL fail the job. Type checking SHALL stay in the build (`tsc --noEmit` for `backend`, `next build` for `frontend`, declaration emit for `packages/database`) until the tsconfigs are compatible with Vite+ type-aware linting.

#### Scenario: Unformatted code fails CI

- **WHEN** a commit with a file that `vp fmt` would change is pushed to any branch
- **THEN** the `build` job's check step fails

#### Scenario: Clean tree passes CI

- **WHEN** a commit whose tree passes `vp check` locally is pushed
- **THEN** the check step succeeds, and the build and test steps run

### Requirement: Vite+ runs on a supported Node version

Every `vp` command in scripts, CI and documentation SHALL run on Node `^22.18.0`, `^24.11.0` or `>=26.0.0`. The repository's mise pin (Node 24) SHALL satisfy this.

#### Scenario: Pinned Node supports Vite+

- **WHEN** `mise exec -- node --version` runs in the repository
- **THEN** it prints a 24.x version of at least 24.11.0, and `vp --version` runs without an engine error
