## Context

The production runtimes are already on Node 24, or partly so:

| Where | Today | Source |
|---|---|---|
| Scraper Lambda | `nodejs24.x` | `infra/scraper.tf` |
| Lambda bundle | esbuild `--target=node24` | `backend/package.json` |
| Vercel build/functions | 18.x (discontinued) → **every deploy fails** | dashboard setting. `frontend/package.json` has no `engines`, and the root's `>=20.0.0` isn't read |
| CI `build`, `migrate` | Node 20 | `setup-node` `node-version: '20'` |
| CI `deploy-frontend` | runner default (22.23.3) | no `setup-node`; `vercel build` runs on the runner |
| Local dev | Node 20 | `.nvmrc` `lts/iron`, read by mise only with `idiomatic_version_file_enable_tools` |
| Types | `@types/node` 20.14.9 ×3 | root, `backend`, `frontend` |

The repo already uses mise for OpenTofu (`mise.toml`, plus `jdx/mise-action@v5` in `deploy-backend`). The Vercel project's Root Directory is `frontend/`. All five `main` runs in the CI history failed in `deploy-frontend` with `BUILD_UTILS_NODE_VERSION_DISCONTINUED`, so no CI run has ever deployed the frontend.

## Goals / Non-Goals

**Goals:**
- One Node pin (`mise.toml`) for local dev and every CI job, matching the Lambda's major.
- Vercel builds and runs on 24.x, set explicitly instead of floating.
- Remove version-related cruft: `.nvmrc`, the Node 16/20 tsconfig presets, `packageManager`, the dead `Dockerfile`, and the stray `frontend/package-lock.json`.

**Non-Goals:**
- Next 15, React 19, eslint 9, or any other major dependency upgrade.
- Changing the Lambda runtime, the bundle format, or OpenTofu resources.
- Moving the codebase to ESM.

## Decisions

**mise.toml is the only pin; `.nvmrc` goes.**
mise reads `mise.toml` with no extra settings. `.nvmrc` only works for mise users who opt in, and keeping both lets them drift apart. `node = "24"` follows the latest 24.x patch, which matches how Lambda's managed `nodejs24.x` runtime is patched.
Alternatives: keep `.nvmrc` = `24` with `setup-node`'s `node-version-file` (rejected: two tools, and mise still needs the opt-in), or keep both files (rejected: drift). Cost: nvm/fnm users lose auto-switching, and `engines.node` still warns them.

**CI uses `jdx/mise-action@v5` with `install_args: node`.**
`setup-node`'s `node-version-file` can't read `mise.toml`. `deploy-backend` already uses mise-action, so using it everywhere gives one mechanism. Passing `install_args: node` keeps Node-only jobs from also downloading OpenTofu. `deploy-backend` keeps its current step: it needs OpenTofu, and it doesn't run Node.
Alternative: `setup-node` with a literal `'24'` (rejected: a second copy of the version that can drift). There's no npm cache today, so moving off `setup-node`'s cache option loses nothing.

**`engines.node: "24.x"`, set in `frontend/package.json` as well as the root.**
Vercel reads `engines` from the Root Directory's `package.json` (`frontend/`), and it overrides the dashboard. A `24.x` value pins the build and function runtime, while an open range like `>=20.0.0` would silently move to Node 26 later. The root and `backend` get the same value so npm warns locally on a wrong Node. The dashboard also gets set to 24.x, so the two agree. Either one alone would fix the discontinued-18.x failure.

**Keep `packageManager`, bumped to `npm@11.19.1`.**
The plan was to drop it, because corepack isn't enabled. But turbo 2.0.5 refuses to run without it (`could not resolve workspaces: missing packageManager field`). It now names the npm that ships with Node 24.22.0 instead of `npm@10.5.2`. Turbo only uses it to detect npm and doesn't check the exact version. Alternative: turbo's `dangerouslyDisablePackageManagerCheck` (rejected: it opts out of a safety check just to avoid one line).

**Hoist `@emotion/react` and `@emotion/styled` to the root.**
The old lockfile had a nested copy for `frontend` (11.10.5) and a root copy (11.11.x) that npm 10 installed as peer dependencies of the root-hoisted `@mui/styled-engine`. npm 11 pruned the root peers, and `next build` then failed with `Can't resolve '@emotion/react'` from `node_modules/@mui/styled-engine`. Removing the nested `frontend/node_modules/@emotion/{react,styled}` lockfile entries lets npm place the pinned 11.10.5 at the root. Now every consumer dedupes to one copy, and a second `npm install` leaves the lockfile unchanged.

**One `node24.json` tsconfig preset.**
Replace `node20.json` with `node24.json`: `target`/`lib` `ES2023`, and everything else unchanged (`module: ES6`, `base.json` parent). `ES2023` is the highest TypeScript 5.5.2 accepts (`ES2024` needs 5.7+), and bumping TypeScript is out of scope. Node 24 supports all of ES2023. Delete `node16.json`, since nothing extends it. `lambda.json` sets its own `target`/`lib` (`ES2022` + `DOM`) and only inherits from the preset, so it just changes `extends`. Its own target stays as is: esbuild sets the bundle target, and `tsc` only type-checks.

**Change dependencies one package at a time, not by regenerating the lockfile.**
Update `@types/node`, `next`, and `eslint-config-next` with targeted `npm install <pkg>@<ver>` calls, and don't delete `package-lock.json`. Before that, pin `@trpc/*` (now `"next"`) to the locked `11.0.0-rc.421`. That way a re-resolve of the `next` dist-tag can't bump tRPC. `next` goes to the latest 14.2.x (14.2.35 at time of writing), with `eslint-config-next` to match.

**Delete `Dockerfile` and `frontend/package-lock.json` instead of upgrading them.**
The Dockerfile dates from the first commit, copies a `prisma/` directory that doesn't exist (the repo uses Drizzle), and nothing builds it. `frontend/package-lock.json` is a stale standalone install: `@types/node` 18, caret ranges, `file:` links to `packages/*`, last touched in commit 2f23642. Even with Root Directory `frontend/`, npm ignores it. Run inside `frontend/`, npm resolves to the workspace root (`npm prefix` prints the repo root) and installs from the root lockfile. Vercel may still look at the nearest lockfile to pick a package manager and npm version. Deleting it removes that ambiguity, and a local `vercel build` checks the result before merging.

## Risks / Trade-offs

- [`@types/node` 24 surfaces type errors in `tsc --noEmit`] → Fix them in this change. They're expected to be few, because the code uses common Node APIs.
- [jest 29 / jsdom 24 / ts-jest behave differently on Node 24] → The `build` job runs tests on 24. If tests fail, fix them here, or upgrade the test stack within the same majors.
- [Lockfile churn from npm 11] → Use targeted installs only, and pin tRPC first. Review the lockfile diff for unexpected version changes before committing.
- [Next 14.2.x deprecation warnings on Node 24 (`punycode`, `url.parse`)] → Treat warnings as noise. Only build or runtime failures block this change.
- [`npm install --global vercel@latest` after mise-action] → mise puts its Node's bin directory on `PATH`, so the global `vercel` binary resolves. Check this in the first `main` run.
- [No CI run has ever deployed the frontend, so the first one may hit a second failure after the Node error (monorepo install from `frontend/`, the prebuilt flow with the downloaded `packages/database/dist` artifact, the Next 14.2 patch bump)] → Run `vercel pull` + `vercel build --prod` locally on the branch before merging. It builds but doesn't deploy.
- [Vercel dashboard and `engines.node` disagree until the manual step] → `frontend`'s `engines.node` takes priority once it's set, so production builds on 24.x either way. The dashboard change keeps the two in agreement.

## Migration Plan

0. Optional, independent of this change: set the Vercel project's Node.js Version to 24.x now. That alone unblocks `deploy-frontend` on the current `main`.
1. Land the change on a branch. The `build` job (every branch) checks the Node 24 build and tests. A local `vercel build --prod` checks the frontend build the way CI will run it.
2. Set the Vercel project's Node.js Version to 24.x before merging, if step 0 didn't already.
3. Merge to `main`. Check that `migrate` and `deploy-frontend` run on Node 24, that the Vercel deployment reports Node 24.x, and that `deploy-backend`'s `tofu apply` doesn't report a runtime change for the Lambda. The bundle hash can change if output differs, and that's fine.

Rollback: revert the commit. It doesn't touch infrastructure state. The Vercel dashboard setting can be moved back by hand.

## Open Questions

None.
