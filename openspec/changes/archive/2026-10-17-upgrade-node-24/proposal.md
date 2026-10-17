## Why

Production frontend deploys are broken. Every `deploy-frontend` run on `main` fails in `vercel build` with `BUILD_UTILS_NODE_VERSION_DISCONTINUED: Node.js Version "18.x" is discontinued`. The Vercel project's Node.js Version is 18.x. Its Root Directory is `frontend/`, so Vercel reads `engines` from `frontend/package.json`, which has none; the root's `>=20.0.0` is never seen. The scraper Lambda already runs on `nodejs24.x` with an esbuild `node24` target, but everything else still says Node 20 or lower. CI's `build` and `migrate` jobs use `setup-node '20'`. `deploy-frontend` runs on whatever Node the runner image ships (22.23.3 in the latest run). `.nvmrc` pins `lts/iron` (20), and mise only reads it because of a per-user opt-in. Code gets type-checked and tested on a different Node than it runs on, and there is no single place that pins the version.

## What Changes

- Pin Node 24 in `mise.toml` (`[tools] node = "24"`). This is the only version pin for local dev and CI. **BREAKING** (dev setup): delete `.nvmrc`, so nvm/fnm users no longer auto-switch. mise no longer needs the `idiomatic_version_file_enable_tools` opt-in.
- CI: the `build`, `migrate`, and `deploy-frontend` jobs get Node from `mise.toml` through `jdx/mise-action@v5` instead of `actions/setup-node`. This gives `deploy-frontend` an explicit Node version for the first time.
- Manifests: set `engines.node` to `24.x` and `@types/node` to `24.x` in the root, `backend`, and `frontend`. `frontend/package.json` is the one that matters for production, because Vercel reads `engines` from the Root Directory. Bump `packageManager` from `npm@10.5.2` to the npm 11 that ships with Node 24 (turbo requires the field).
- tsconfig presets: replace `node20.json` with `node24.json` (ES2023 target/lib, the highest TypeScript 5.5 supports), delete the unused `node16.json`, and point `lambda.json` and `packages/database/tsconfig.json` at `node24.json`.
- Dependencies: move `next` and `eslint-config-next` from 14.2.4 to the latest 14.2.x patch. Pin `@trpc/*` from the floating `next` dist-tag to the version already locked (`11.0.0-rc.421`), so lockfile regeneration can't pull in a different tRPC.
- Remove cruft: the unused `Dockerfile` (it copies a nonexistent `prisma/`) and the tracked `frontend/package-lock.json`. That lockfile is a stale standalone install (`@types/node` 18, caret ranges). npm ignores it, because run inside `frontend/` it resolves to the workspace root and uses the root lockfile.
- Vercel: set the project's Node.js Version setting from 18.x to 24.x. This alone unblocks deploys, and it agrees with `frontend`'s `engines.node`.
- README: update the mise setup steps (no `.nvmrc`, no idiomatic-file opt-in).

## Capabilities

### New Capabilities
- `node-toolchain`: Which Node version the repo pins and where. Covers the `mise.toml` pin, CI jobs getting Node from it, `engines.node` and `@types/node` matching the Lambda runtime's major, and Vercel building and running on that same major.

### Modified Capabilities
<!-- None: the Lambda runtime and bundle target (scraper-infrastructure, infra-delivery) already require Node 24. -->

## Impact

- Files: `mise.toml`, `.nvmrc` (deleted), `.github/workflows/cicd.yml`, `package.json` (root, `backend`, `frontend`), `package-lock.json`, `packages/tsconfig/*.json`, `packages/database/tsconfig.json`, `Dockerfile` (deleted), `frontend/package-lock.json` (deleted), `README.md`.
- Systems: GitHub Actions runners (Node 24 in every Node job), the Vercel project setting, and the Vercel build and function runtime (from a discontinued 18.x to 24.x). This restores production frontend deploys. No CI run has deployed the frontend successfully yet, so the first one may surface other problems.
- No change to the Lambda (`nodejs24.x` and the `node24` bundle target stay as they are) or to OpenTofu state.
- Developers: you need mise for automatic version switching. `mise install` picks up Node 24.
