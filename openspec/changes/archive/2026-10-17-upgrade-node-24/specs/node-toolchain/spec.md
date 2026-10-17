## ADDED Requirements

### Requirement: Single Node version pin

The repository SHALL pin its Node version in exactly one place: `node = "24"` under `[tools]` in the root `mise.toml`. The repository SHALL NOT contain `.nvmrc`, `.node-version`, or `.tool-versions` files. The pinned major SHALL match the scraper Lambda's runtime major (`nodejs24.x`) and the esbuild bundle target (`node24`).

#### Scenario: Stock mise picks up Node 24

- **WHEN** a developer with default mise settings (no `idiomatic_version_file_enable_tools`) runs `mise install` and opens a shell in the repo
- **THEN** `node --version` prints `v24.x`

#### Scenario: No competing version files

- **WHEN** the repository (excluding `node_modules`) is searched for `.nvmrc`, `.node-version`, and `.tool-versions`
- **THEN** none are found

### Requirement: CI uses the pinned Node version

Every CI job that runs `node`, `npm`, `npx`, or the Vercel CLI SHALL get Node from `mise.toml` through `jdx/mise-action`. The workflow SHALL NOT name a Node version literally, and SHALL NOT use `actions/setup-node`.

#### Scenario: Build job runs on Node 24

- **WHEN** the `build` job runs on any branch
- **THEN** it installs Node from `mise.toml`, and `npm ci`, `npm run build`, and `npm run test` run on Node 24

#### Scenario: Frontend build runs on Node 24

- **WHEN** the `deploy-frontend` job runs `vercel build` on `main`
- **THEN** the build runs on Node 24 from `mise.toml`, not the runner image's default Node

#### Scenario: No literal version in the workflow

- **WHEN** `.github/workflows/cicd.yml` is searched for `setup-node` and `node-version`
- **THEN** no matches are found

### Requirement: Declared engine and types match the pinned major

The root, `backend`, and `frontend` `package.json` files SHALL declare `engines.node` as `24.x`, and SHALL use `@types/node` with major version 24 wherever they depend on it. `frontend/package.json` SHALL always declare it, because the Vercel project's Root Directory is `frontend/` and Vercel reads `engines` from there. The root `package.json` SHALL declare `packageManager` as an npm 11.x version, the npm major bundled with Node 24, because turbo needs it to resolve workspaces.

#### Scenario: Manifests agree

- **WHEN** the `engines.node`, `@types/node`, and `packageManager` entries in the root, `backend`, and `frontend` manifests are read
- **THEN** every `engines.node` is `24.x`, every `@types/node` is a 24.x version, and the root `packageManager` is `npm@11.x`

### Requirement: Vercel builds and runs on the pinned major

The Vercel project SHALL build the frontend and run its functions on Node 24.x. The project's Node.js Version setting SHALL be 24.x, which agrees with `frontend/package.json`'s `engines.node`.

#### Scenario: Frontend deploy succeeds

- **WHEN** the `deploy-frontend` job runs on `main`
- **THEN** `vercel build` and `vercel deploy` succeed, with no `BUILD_UTILS_NODE_VERSION_DISCONTINUED` error

#### Scenario: Production deploy on Node 24

- **WHEN** a commit on `main` deploys to Vercel production
- **THEN** the deployment reports Node.js 24.x and shows no warning that `engines.node` overrides the project setting
