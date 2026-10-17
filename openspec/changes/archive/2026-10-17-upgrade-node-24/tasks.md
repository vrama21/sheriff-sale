## 1. Version pin

- [x] 1.1 Add `node = "24"` under `[tools]` in `mise.toml`, and delete `.nvmrc`
- [x] 1.2 With the global `idiomatic_version_file_enable_tools` setting removed (or `MISE_IDIOMATIC_VERSION_FILE_ENABLE_TOOLS=` cleared), run `mise install` and check that `node --version` in the repo prints `v24.x`
- [x] 1.3 Update the README mise setup: mise reads Node from `mise.toml`, and the "Let mise read `.nvmrc` files" step is removed (renumber the steps that follow)

## 2. Manifests and dependencies

- [x] 2.1 Pin `@trpc/client`, `@trpc/next`, `@trpc/react-query`, and `@trpc/server` in `frontend/package.json` from `"next"` to `11.0.0-rc.421`, the locked version, and check that `npm install` leaves their lockfile entries unchanged
- [x] 2.2 Set `engines.node` to `24.x` in the root, `backend`, and `frontend` `package.json` (`frontend` is the one Vercel reads), and bump the root `packageManager` to `npm@11.19.1` (turbo requires the field)
- [x] 2.3 Move `@types/node` to the latest 24.x in the root, `backend`, and `frontend` with targeted `npm install` (keep `package-lock.json`)
- [x] 2.4 Move `next` (frontend) and `eslint-config-next` (packages/config) to the latest 14.2.x patch
- [x] 2.5 Review the `package-lock.json` diff and confirm only the intended packages and their transitive dependencies changed
- [x] 2.6 Hoist `@emotion/react` and `@emotion/styled` to the root (drop the nested `frontend/node_modules/@emotion/*` lockfile entries) after npm 11 pruned the root peer copies that `@mui/styled-engine` resolves, and confirm a re-install leaves the lockfile unchanged

## 3. tsconfig presets

- [x] 3.1 Create `packages/tsconfig/node24.json` from `node20.json`, with `display: "Node 24"`, `target: "ES2023"`, `lib: ["ES2023"]` (TypeScript 5.5 doesn't accept ES2024), and delete `node20.json` and `node16.json`
- [x] 3.2 Point `packages/tsconfig/lambda.json` and `packages/database/tsconfig.json` at `node24.json`
- [x] 3.3 Check that nothing references `node16.json` or `node20.json` anymore (`grep -rn 'node16\|node20' --exclude-dir=node_modules --exclude-dir=openspec`)

## 4. Cruft removal

- [x] 4.1 Delete `Dockerfile`
- [x] 4.2 Delete `frontend/package-lock.json`. Check that `npm ci` at the root still installs the frontend workspace, and that `npm prefix` inside `frontend/` still prints the repo root

## 5. CI

- [x] 5.1 In `.github/workflows/cicd.yml`, replace `actions/setup-node` in `build` and `migrate` with `jdx/mise-action@v5` and `install_args: node`
- [x] 5.2 Add the same `jdx/mise-action@v5` step (`install_args: node`) to `deploy-frontend` before the Vercel CLI install
- [x] 5.3 Check that the workflow has no `setup-node` or `node-version` left, and that `deploy-backend` is unchanged

## 6. Local verification on Node 24

- [x] 6.1 Run `npm ci && npm run build && npm run test` at the root on Node 24, and fix any type errors from `@types/node` 24 or test failures
- [x] 6.2 Check that `require('./backend/dist/index.js').handler` is a function under Node 24
- [x] 6.3 Run `npm run lint` and check it still passes, or fails no worse than on `main`
- [x] 6.4 Run the frontend with `npm run dev` and load the main page to smoke-test it on Node 24

## 7. Vercel and rollout

- [x] 7.1 Set the Vercel project's Node.js Version (Settings → Build and Deployment) from 18.x to 24.x (manual; may already be done ahead of this change to unblock deploys)
- [x] 7.2 On the branch, under Node 24 at the repo root, run `vercel pull --yes --environment=production` and `vercel build --prod` (no deploy), and confirm the build succeeds with Root Directory `frontend/` and the frontend lockfile gone
- [x] 7.3 Push the branch and confirm the `build` job passes on Node 24
- [x] 7.4 After merging to `main`, confirm `migrate` and `deploy-frontend` ran on Node 24, `vercel` resolved after mise-action, `deploy-frontend` succeeded (the first successful CI frontend deploy), and the Vercel deployment reports Node.js 24.x
- [x] 7.5 Confirm `deploy-backend`'s `tofu apply` didn't change the Lambda runtime (still `nodejs24.x`)
