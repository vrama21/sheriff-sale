## MODIFIED Requirements

### Requirement: Workspaces declare what they use

Each of `backend` and `packages/database` SHALL declare, in its own `package.json`, every package its sources import and every package binary its scripts run, other than the root-level tooling (`turbo`, `typescript`). A package imported at runtime by code that ships in the workspace's build output SHALL be a `dependency`. A package used only by scripts, tests, local runners or config files SHALL be a `devDependency`. The root `package.json` SHALL declare only `turbo`, `typescript`, `@types/node` and `vite-plus`.

#### Scenario: Backend declares its tools

- **WHEN** `backend/package.json` is read
- **THEN** `esbuild`, `tsx`, `dotenv` and `vite-plus` are among its `devDependencies`

#### Scenario: Database declares its runtime and tools

- **WHEN** `packages/database/package.json` is read
- **THEN** `drizzle-orm` and `postgres` are `dependencies`, and `dotenv`, `tsx`, `drizzle-kit` and `vite-plus` are `devDependencies`. Only `drizzle.config.ts` and `src/migrate.ts` import `dotenv`, and neither ships in `dist`.

#### Scenario: Root keeps only shared tooling

- **WHEN** the root `package.json` is read
- **THEN** its `devDependencies` are exactly `turbo`, `typescript`, `@types/node` and `vite-plus`, and it has no `dependencies`
