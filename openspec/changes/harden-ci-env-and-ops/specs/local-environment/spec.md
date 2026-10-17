## ADDED Requirements

### Requirement: Single local env file

The repo-root `.env` SHALL be the only env file that local tooling reads. `packages/database/drizzle.config.ts`, `packages/database/src/migrate.ts`, `backend/src/modules/sheriffSale/handler.local.ts`, `backend/src/modules/sheriffSale/replay/index.ts`, the `frontend` `dev` script, `docker-compose.yml`, and the db-query skill's local connection SHALL all read `<root>/.env`, resolved independently of the working directory. No file in the repository SHALL load `.env.local`. Library code, such as `packages/database/src/client.ts`, SHALL read `process.env` only and SHALL NOT load any env file. An entry point that loads `.env` SHALL do so before it loads the database client.

#### Scenario: Every tool sees the same database

- **WHEN** `DATABASE_URL` is set only in `<root>/.env`, and `npm run db:migrate`, `npm run db:generate`, `npm run start:newJerseyScraper` (in `backend`), and `npm run dev` (in `frontend`) run
- **THEN** each of them uses that `DATABASE_URL`

#### Scenario: No env-file loading in library code

- **WHEN** `packages/database/src/` (excluding `migrate.ts`) is searched for `dotenv`
- **THEN** no matches are found

#### Scenario: No `.env.local` references

- **WHEN** the repository (excluding `node_modules`, lockfiles, `openspec/`, and `.gitignore`) is searched for `.env.local`
- **THEN** no matches are found

### Requirement: Committed env example

The repository SHALL commit `<root>/.env.example`, listing every variable a local setup reads: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. The file SHALL contain no real secrets. `.gitignore` SHALL ignore every other `.env*` file and SHALL NOT contain negations for files that don't exist. The root README SHALL document local database setup: copy `.env.example` to `.env`, run `docker compose up -d`, and run `npm run db:migrate`.

#### Scenario: Example is tracked

- **WHEN** `git check-ignore .env.example` runs
- **THEN** it reports the file as not ignored, and `git ls-files .env.example` lists it

#### Scenario: Fresh setup from the example

- **WHEN** a developer copies `.env.example` to `.env`, starts docker compose, and runs `npm run db:migrate`
- **THEN** migrations apply to the local container without further configuration

### Requirement: Declared env variables match what code reads

`turbo.json` `globalEnv` SHALL list exactly the variables that turbo-run tasks read: `DATABASE_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NODE_ENV`, `PORT`, and `VERCEL_URL`. `globalDependencies` SHALL hash `<root>/.env`. `backend/src/environment.d.ts` SHALL declare only variables the backend reads. The repository SHALL NOT set or declare `ENV` or `NJ_SCRAPER_BUCKET_NAME`.

#### Scenario: No dead variables

- **WHEN** `.github/workflows/cicd.yml`, `turbo.json`, `backend/src/`, and `infra/` are searched for `\bENV\b` and `NJ_SCRAPER_BUCKET_NAME`
- **THEN** no matches are found

### Requirement: Browser-visible Maps key

The frontend SHALL read the Google Maps API key from `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, so that Next.js inlines it into the client bundle. The Vercel project SHALL define the variable under that name.

#### Scenario: Key reaches the browser

- **WHEN** `next build` runs with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=test-key` and the built client chunks are searched
- **THEN** `test-key` appears in the `_app` chunk

### Requirement: Local Postgres service

`docker-compose.yml` SHALL declare the compose project name `sheriff-sale` and a single `postgres` service with:

- the image pinned to prod's major version (`postgres:15`), with its volume mounted where that major keeps its data (`/var/lib/postgresql/data`)
- the container name `sheriff-sale-postgres`
- `restart: unless-stopped`
- the host port bound to `127.0.0.1` only, with the port taken from `POSTGRES_PORT` (default 5432)
- `env_file: .env`
- a `pg_isready` healthcheck

It SHALL NOT declare the obsolete `version` key, `expose`, or any admin UI service.

#### Scenario: Container is healthy and local-only

- **WHEN** `docker compose up -d` runs with a `.env` copied from `.env.example`
- **THEN** `docker compose ps` shows `sheriff-sale-postgres` as healthy, and its port is published on `127.0.0.1` only

#### Scenario: Major matches prod

- **WHEN** `select version()` runs against the local container and against prod
- **THEN** both report the same major version
