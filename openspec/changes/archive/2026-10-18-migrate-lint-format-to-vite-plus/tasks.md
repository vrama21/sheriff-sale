## 1. Run the migrator

- [x] 1.1 Under Node 24, run `npx --package=vite-plus@1.3.0 vp migrate --no-interactive --no-agent --no-hooks --editor vscode` from the workspace root, and save its report
- [x] 1.2 If ESLint, Prettier or tsup were not converted, rerun with `--full` (same agent/hooks/editor flags) and save the report
- [x] 1.3 Review the migrator diff (package.json files, lockfile, `vite.config.ts`, scripts, `.vscode`) and note anything to correct by hand

## 2. Lint configuration

- [x] 2.1 Set the root `vite.config.ts` `lint` block: base plugins, `no-unused-vars` with `argsIgnorePattern: '^_'`, ignore patterns for generated output
- [x] 2.2 Add a `frontend/**` override enabling `react`, `nextjs`, `jsx-a11y`, with `react/jsx-key` and `nextjs/no-html-link-for-pages` off
- [x] 2.3 Check the two inline `eslint-disable` comments (`ListingTable.tsx`, `Select.tsx`) against the Oxlint rule names
- [x] 2.4 Drop `turbo/no-undeclared-env-vars` (design D4), and confirm every env var the frontend reads is in `turbo.json`
- [x] 2.5 Point each workspace's `lint` script at `vp lint <dirs>`, remove `lint:fix` or map it to `vp lint --fix`, and confirm `vp lint` from a package directory uses the root config
- [x] 2.6 Run `vp lint`, then fix real findings or turn off noise rules with a reason. Compare with the ESLint baseline (2 `exhaustive-deps` warnings)

## 3. Format configuration

- [x] 3.1 Set the root `fmt` block to the Prettier options and ignores
- [x] 3.2 Check whether Oxfmt formats Markdown, and record the result in design.md
- [x] 3.3 Point the root `format` script at `vp fmt`
- [x] 3.4 Diff `vp fmt` output against `prettier --write` output on a scratch copy, and review the differences
- [x] 3.5 Apply the reformat as a separate step from the config changes

## 4. Database package build

- [x] 4.1 Move `tsup.config.ts` options into the `pack` block, and delete `tsup.config.ts`
- [x] 4.2 Set `build`/`dev` to `vp pack`/`vp pack --watch`, keeping the `prebuild`/`predev` drizzle hooks
- [x] 4.3 Run `vp pack`, and update `main`/`module`/`types` (and `exports`) to the emitted files
- [x] 4.4 Review the tsdown <0.23 compatibility settings one at a time (remove, `vp pack`, build backend and frontend), and record which are kept

## 5. Remove the old toolchain

- [x] 5.1 Delete `packages/config` and its references in workspace `devDependencies`
- [x] 5.2 Delete `.eslintrc.js`, `.eslintignore` and `.prettierrc.js` files
- [x] 5.3 Remove the ESLint, Prettier and tsup dependencies, and reinstall so `package-lock.json` matches
- [x] 5.4 Confirm `next build` still works without ESLint installed

## 6. CI

- [x] 6.1 Add a `vp check` step to the `build` job in `.github/workflows/cicd.yml`, after `npm ci` and before build

## 7. Validate

- [x] 7.1 `vp check`, `vp lint` and `vp fmt --check` pass at the root under Node 24
- [x] 7.2 `vp pack` passes in `packages/database`
- [x] 7.3 `npm run build` (turbo: database pack, backend tsc + esbuild, frontend `next build`) passes
- [x] 7.4 Backend `npm test` (Jest) passes
- [x] 7.5 `npm run lint` (turbo) passes
- [x] 7.6 Rerun the migrator, and confirm it produces no further diff (idempotent)
