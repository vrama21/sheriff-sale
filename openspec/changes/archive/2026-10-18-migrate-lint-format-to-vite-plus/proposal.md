## Why

Linting and formatting run on an unmaintained stack: ESLint 8 with legacy `.eslintrc.js` files (two of them identical, and one a copy of a shared config that nothing references), Prettier 3.3, and a `packages/config` workspace that exists only to hold those configs. CI runs neither, so drift goes unnoticed. Vite+ (`vite-plus@1.3.0`) bundles Oxlint, Oxfmt and tsdown behind one CLI and one root `vite.config.ts`, which replaces all three tools and makes a single `vp check` gate cheap enough to run in CI.

## What Changes

- Add `vite-plus@1.3.0` (pinned) as a root dev dependency and a root `vite.config.ts` with `lint`, `fmt` and `pack` blocks. Per-workspace differences go in `lint.overrides`, not in per-package config files.
- Replace ESLint with `vp lint` (Oxlint) in `backend`, `frontend` and `packages/database`. The rule set maps `eslint:recommended` to the `eslint` plugin, `@typescript-eslint/recommended` to the `typescript` plugin, and `eslint-config-next` to the `nextjs`, `react` and `jsx-a11y` plugins. It keeps the `no-unused-vars` `^_` argument exception and the frontend's `react/jsx-key` and `no-html-link-for-pages` opt-outs.
- Replace Prettier with `vp fmt` (Oxfmt), keeping the current style (120 columns, single quotes, semicolons, trailing commas, 2-space indent). The one-time reformatting is reviewed against Prettier's output and kept separate from the config changes.
- Build `packages/database` with `vp pack` (tsdown) instead of tsup, keeping the CJS + ESM + `.d.ts` outputs that `backend` and `frontend` consume, and keeping the `drizzle-kit generate` pre-hooks.
- **BREAKING (dev workflow)**: delete `packages/config`, the `.eslintrc.js`, `.eslintignore` and `.prettierrc.js` files, and the ESLint and Prettier dependencies. `npm run format` now runs `vp fmt`.
- Add a `vp check` step (format check and lint) to the CI `build` job. Type checking stays in `tsc --noEmit` and `next build`.
- Unchanged: Turbo stays the task runner, the per-package `lint` scripts stay, `next build` stays the frontend build, `tsc --noEmit` + esbuild stays the Lambda build, and Jest stays the backend test runner.

## Capabilities

### New Capabilities

- `vite-plus-toolchain`: how the repo lints, formats and checks its code with Vite+, and how `packages/database` is packaged with `vp pack`, including the CI gate and the Node versions Vite+ requires.

### Modified Capabilities

<!-- None: existing specs only require that `npm run build`, `npm run test` and per-workspace `npm run lint` pass, and that still holds. -->

## Impact

- **Files**: root `package.json`, `package-lock.json`, new `vite.config.ts`, `turbo.json` (if needed), `.github/workflows/cicd.yml`, the `backend`, `frontend` and `packages/database` `package.json` files, `packages/database/tsup.config.ts` (removed), `packages/config/` (removed), `.eslintrc.js` / `.eslintignore` / `.prettierrc.js` files (removed), and source files touched by the one-time reformat and any lint fixes.
- **Dependencies**: adds `vite-plus`. Removes `prettier`, `eslint`, `@typescript-eslint/*`, `eslint-config-*`, `eslint-plugin-*` and `tsup`.
- **Runtime**: none. The Lambda bundle and the Next.js app are built the same way. `@sheriff-sale/database`'s `dist` layout may change file names (tsdown vs tsup), so `main`/`module`/`types` must point at what `vp pack` emits.
- **Tooling**: every `vp` command needs Node `^22.18.0 || ^24.11.0 || >=26.0.0`. The repo pins Node 24 through mise, and CI already uses it.
