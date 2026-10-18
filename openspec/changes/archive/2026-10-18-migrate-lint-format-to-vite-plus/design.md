## Context

The repo is an npm-workspaces monorepo (`backend`, `frontend`, `packages/*`) run by Turbo 2.0.5 on Node 24 (pinned in `mise.toml`). Today:

- **Lint**: ESLint 8 with legacy rc files. `backend/.eslintrc.js` and `packages/database/.eslintrc.js` are identical (`eslint:recommended` + `@typescript-eslint/recommended`, `no-unused-vars` with `argsIgnorePattern: '^_'`). `frontend/.eslintrc.js` extends `next`, `turbo` and `prettier`, and turns off `@next/next/no-html-link-for-pages` and `react/jsx-key`. It runs through `next lint`, and ESLint is only reachable there through hoisting. `packages/config` holds copies of these configs and the Prettier config, and only `.prettierrc.js` references it.
- **Format**: Prettier 3.3.2, `prettier --write "**/*.{ts,tsx,md}"`, with `{ printWidth: 120, singleQuote: true, semi: true, trailingComma: 'all', tabWidth: 2, bracketSpacing: true }`. It is not enforced: at the time of writing, 8 frontend TS files and about 30 Markdown files (mostly `openspec/`) fail `prettier --check`.
- **Library build**: `packages/database` builds with tsup 8.1.0 (`tsup.config.ts`: `src/index.ts`, `cjs` + `esm`, `dts`, `sourcemap`, `clean`, `minify` when `NODE_ENV=production`). Its `prebuild`/`predev` hooks run `drizzle-kit generate`. `backend` (esbuild bundle, Jest) and `frontend` (Next 14) consume its `dist`.
- **CI**: `.github/workflows/cicd.yml` `build` job runs `npm ci`, `npm run build` and `npm run test`. No lint or format.
- **Baseline lint**: `turbo run lint` passes. The frontend reports two `react-hooks/exhaustive-deps` warnings.

Vite+ 1.3.0 ships Oxlint, Oxfmt and tsdown behind `vp`. Its migrator (`vp migrate`) must run from the workspace root and rewrites every package at once. Vite+ needs Node `^22.18.0 || ^24.11.0 || >=26.0.0`. Non-login shells on the dev machine can resolve Node 25, so every `vp`/`npx` call in this change runs through `mise exec node@24 --`.

## Goals / Non-Goals

**Goals:**

- One linter and one formatter for all three code workspaces, configured in a single root `vite.config.ts` (plus a pack-only `packages/database/vite.config.ts`, see D6).
- Keep today's rule intent (recommended JS/TS rules, Next/React/a11y rules for the frontend) and today's formatting style.
- `packages/database` packaged by `vp pack` with the same consumable outputs.
- A `vp check` gate in CI.
- Remove ESLint, Prettier, tsup and `packages/config`.

**Non-Goals:**

- Jest → Vitest, esbuild → `vp pack` for the Lambda, Turbo → `vp run`, `vp dev`/`vp build` for Next.js.
- Type-aware lint rules (none exist today).
- Git hooks / lint-staged (none exist today).
- Changing the agent instruction files (`CLAUDE.md`/`AGENTS.md`).

## Decisions

### D1. Run the migrator first, then hand-finish

Run `npx --package=vite-plus@1.3.0 vp migrate --no-interactive --no-agent --no-hooks --editor vscode` from the root under Node 24. If ESLint, Prettier or tsup are left unconverted, rerun with `--full`, keeping the same agent/hooks flags. The migrator owns the mechanical parts (dependency pins, script rewrites, config merge into `vite.config.ts`, tsdown 0.23 option renames). Everything it can't infer, such as plugin selection, overrides and the turbo rule, is finished by hand and reviewed.

- `--no-agent`: the repo's `CLAUDE.md` is hand-maintained. The migrator must not rewrite it.
- `--no-hooks`: the repo has no husky or lint-staged and no hook policy. CI is the gate, so adding a pre-commit hook would be a new developer-workflow change that nobody asked for.
- `--editor vscode`: `.vscode/settings.json` is committed and sets Prettier as the default formatter and ESLint fix-on-save. Both are removed by this change, so leaving the file as is would break format-on-save for VS Code users. Let the migrator write the Oxc editor settings, and review that it doesn't drop unrelated settings. Fallback if the output is wrong: `--no-editor`, plus a hand edit that points the formatter at Oxc.
- Alternative considered: hand-writing everything without the migrator. Rejected because the migrator also normalizes npm overrides/aliases and the `vite-plus` pin, which is easy to get wrong.

### D2. One root `vite.config.ts`, per-workspace differences in `overrides`

`vp check` always reads the root `lint`/`fmt` blocks, so per-package `.oxlintrc.json`/`.oxfmtrc.json` or per-package `vite.config.ts` would create configs that `vp check` ignores. Base plugins are `eslint`, `typescript`, `unicorn` and `oxc` (Oxlint's defaults are correctness-only, which approximates `eslint:recommended` + `ts/recommended`). One override for `frontend/**` enables `react`, `nextjs` and `jsx-a11y` with `react/jsx-key` and `nextjs/no-html-link-for-pages` off. The global `no-unused-vars` rule keeps `argsIgnorePattern: '^_'`.

### D3. Turbo keeps running per-package `lint`

Each workspace keeps a `lint` script that calls `vp lint` on its own sources (backend `vp lint src scripts`, database `vp lint src`, frontend `vp lint src`), so `npm run lint` → `turbo run lint` behaves as before and stays cacheable per package. This relies on `vp lint` finding the root `vite.config.ts` from a package directory. If it doesn't, the fallback is a root `lint` script (`vp lint`) and dropping the Turbo `lint` task. CI uses the root `vp check` regardless.

### D4. `turbo/no-undeclared-env-vars`: drop it

Oxlint has no native equivalent. Loading `eslint-plugin-turbo` through `lint.jsPlugins` would keep a dependency on an ESLint plugin, and on its `eslint-config-turbo` versioning tied to Turbo 2.0.5, for one rule. Every env var the frontend reads (`NEXT_GOOGLE_MAPS_API_KEY`, `VERCEL_URL`, `NODE_ENV`, `PORT`, `DATABASE_URL`, ...) is already in `turbo.json` `globalEnv`, and the backend and database never ran the rule. Decision: drop it and record it here. Revisit if Turbo caching ever misses an env var.

### D5. Formatting

`fmt` copies the Prettier options (`printWidth: 120`, `singleQuote: true`, `semi: true`, `trailingComma: 'all'`, `tabWidth: 2`, `bracketSpacing: true`). Oxfmt is Prettier-compatible, but the output is diffed against `prettier --write` before acceptance, and the reformat is applied as a separate step from the config changes. Markdown: whether Oxfmt formats `.md` is verified during apply. If it does, `openspec/**` Markdown is included and reformatted like the code. If not, Markdown is left unformatted and the gap is reported. Generated and vendored paths (`**/dist`, `.next`, `packages/database/drizzle`, `package-lock.json`, `.turbo`, `infra/.terraform`) are ignored.

### D6. `packages/database` → `vp pack`

Move `tsup.config.ts` into the root `vite.config.ts` `pack` block (or let the migrator do it), with the same entry, `cjs`+`esm` formats, `dts`, `sourcemap`, `clean`, and minify on `NODE_ENV=production`. tsdown names outputs differently from tsup (`.cjs`/`.mjs`/`.d.cts`/`.d.mts` vs `.js`/`.mjs`/`.d.ts`), so `main`/`module`/`types` (and an `exports` map if needed) are updated to match the emitted files. `build`/`dev` become `vp pack`/`vp pack --watch`, keeping `prebuild`/`predev`.

- tsdown <0.23 compatibility settings (`deps.resolveDepSubpath: true`, `attw.profile: 'strict'`), if the migrator inserts them, are reviewed one at a time. Remove one, rerun `vp pack`, then build `backend` and `frontend` (the consumers). Keep the setting only if a consumer breaks without it.

### D7. CI gate

Add a `Check` step to the `build` job after `npm ci`: `npx vp check`. It runs on Node 24 from mise, like the other steps. It goes before `npm run build` so format and lint failures surface fast.

## Risks / Trade-offs

- [Oxfmt output differs from Prettier in edge cases] → Diff against Prettier output, and review the reformat before accepting it.
- [Oxlint reports new findings that ESLint didn't (different rule coverage)] → Fix real issues in source, and turn off rules that only produce noise, with a reason recorded in the config.
- [Oxlint's `react-hooks` coverage differs] → Compare the warnings before and after: the two `exhaustive-deps` warnings should still appear.
- [tsdown output file names break `@sheriff-sale/database` resolution in Next.js or esbuild] → Update the `package.json` entry points, then run the full `turbo build` (including `next build`) and the backend Jest suite.
- [A root `vite.config.ts` confuses Next.js or Jest] → Neither reads it. Verified by `next build` and `npm test`.
- [Vite+ on Node 25 fails locally] → The mise pin is Node 24. Commands in this change run under `mise exec node@24`.
- [Removing ESLint from the frontend changes `next build`] → `next build` runs lint only when ESLint is installed. Without it, Next 14 warns and skips. Verify the build still passes, and set `eslint.ignoreDuringBuilds` if it doesn't.

## Migration Plan

1. Migrate (D1), then hand-finish config (D2–D6), CI (D7) and deletions.
2. Reformat as a separate step.
3. Validate: `vp check`, `vp lint`, `vp fmt --check`, `vp pack`, `npm run build`, backend `npm test`, `npm run lint`.
4. Rollback: revert the change. No runtime or data impact.

## Open Questions

All four were resolved during apply. See Implementation Outcomes.

## Implementation Outcomes

- **Migrator (D1)**: `vp migrate --no-interactive --no-agent --no-hooks --editor vscode` converted Prettier (to the `fmt` block) and tsup (to a `tsdown.config.ts` plus a package `vite.config.ts`). It did not convert ESLint ("ESLint detected in workspace packages but no root config found. Package-level ESLint must be migrated manually."), and `--full` gave the same result, so the `lint` block is hand-written. It also added `vite-plus` to the root and database `devDependencies`, a root `overrides.vite` alias to `@voidzero-dev/vite-plus-core`, and `.vscode/extensions.json`, and it dropped `baseUrl` from `frontend/tsconfig.json` (unused: no imports depend on it). The first run appended Oxc keys next to the Prettier/ESLint VS Code settings. Those were removed by hand, and a second run added per-language Oxc formatter entries. A third run produced no diff, so the migration is idempotent.
- **Type-aware lint off**: the migrator set `lint.options: { typeAware: true, typeCheck: true }`. tsgolint (TypeScript 7) rejects every tsconfig in the repo (`moduleResolution: node` (node10) in `packages/tsconfig/base.json`, and `target: es5` in `nextjs.json`). Moving those is a module-resolution change for Next, esbuild and Jest, which is out of scope, so both options are `false`. `vp check` is therefore format + lint only, and type checks stay where they were.
- **Pack config location (D2/D6)**: tsdown options live in a `pack` block in `packages/database/vite.config.ts`, the per-package layout the migrator produces and `vp pack` reads from the package directory. It has no `lint`/`fmt` block, so lint and format still resolve to the root config.
- **Lint scripts (D3)**: `vp lint` run from a package directory uses the root config, and `frontend/**` overrides still apply. The Turbo `lint` task is unchanged, but the root `vite.config.ts` is now in `turbo.json` `globalDependencies`: the package `lint` tasks read it from outside their package directories, so without it a rule change would replay cached results. (Turbo 2.0.5 predates `$TURBO_ROOT$` task inputs.)
- **Lint results**: `no-unused-vars` now also covers the frontend (eslint-config-next never enabled it). Four findings were fixed in source: an unused `MenuP` import, `opts` → `_opts`, a dropped unused `{ input }` destructure, and `ignoreRestSiblings: true` for the `connection: _connection, ...headers` omit pattern. Both baseline `exhaustive-deps` warnings remain, plus one new one on the same line (`mobileView` is an unnecessary dependency). Of the inline disables, `react/no-children-prop` still suppresses a real report. `react/jsx-key` is a real rule but already off, so the `ListingTable.tsx` disable is a no-op, as it was under ESLint.
- **Formatting (D5)**: Oxfmt formats Markdown (and JSON, YAML, JS and HTML too), so `npm run format` is now plain `vp fmt`, which covers more than `**/*.{ts,tsx,md}`. Ignored: `**/__fixtures__/**` (scraped HTML) and `packages/database/drizzle/**` (drizzle-kit snapshots). Markdown sets `embeddedLanguageFormatting: 'off'` so fenced examples (for example, a scraped value with trailing spaces) stay verbatim. Compared with Prettier 3.3.2 on the same files, Oxfmt differed in two places only: multi-line `interface … extends` wrapping in `react-table-config.d.ts`, and leaving `Upset*` unescaped where Prettier writes `Upset\*`. `openspec validate --all --strict` passes after the reformat.
- **Pack (D6)**: tsdown emits `index.cjs`/`index.mjs`/`index.d.cts`/`index.d.mts`, so `main` → `./dist/index.cjs` and `types` → `./dist/index.d.cts`. `module` is unchanged, and no `exports` map was added, to keep resolution as before. `dotenv` stays inlined, as it was under tsup. The migrator inserted only `deps.resolveDepSubpath: true` (ATTW is not enabled, so there is no `attw.profile`). Removing it gave byte-identical `dist` output, and backend `tsc`/esbuild, `next build` and Jest pass, so it was removed. The `@rollup/rollup-linux-x64-gnu` optional dependency existed only for tsup's Rollup on Linux CI, so it was removed too.
- **Follow-ups (out of scope)**: make the tsconfigs TS7-compatible and turn on `typeAware`/`typeCheck`. Delete the stale `backend/package-lock.json`, which still lists ESLint, tsup and `@sheriff-sale/config`, although npm workspaces ignore it. Consider fixing the three `exhaustive-deps` warnings.
