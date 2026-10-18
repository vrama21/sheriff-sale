# sheriff-sale

Turborepo monorepo with npm workspaces:

- `backend/`: the scraper Lambda's sources, bundled with esbuild
- `infra/`: OpenTofu config for the AWS resources (see [`infra/README.md`](infra/README.md))
- `frontend/`: Next.js app
- `packages/`: shared packages (`database` uses Drizzle; `tsconfig` holds the shared TypeScript configs)

## Setup

### mise

[mise](https://mise.jdx.dev) switches the Node version (from `mise.toml`) and loads this repo's environment variables, such
as `AWS_PROFILE`, when you `cd` into the repo.

1. Install mise and hook it into your shell (for other shells, see the
   [getting started guide](https://mise.jdx.dev/getting-started.html)):

   ```bash
   brew install mise
   echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
   ```

2. Create `mise.local.toml` in the repo root with your own values. It is gitignored, and mise loads it on top of
   `mise.toml`:

   ```toml
   [env]
   AWS_PROFILE = "<aws profile for this account>"
   # Optional, if you have more than one gh account:
   GH_TOKEN = "{{ exec(command='gh auth token --user <github user>') }}"
   # Only needed to run tofu plan/apply in infra/ yourself:
   TF_VAR_database_url = "<DATABASE_URL>"
   ```

3. Trust the repo's config and install Node and OpenTofu:

   ```bash
   mise trust
   mise install
   ```

To check it, open a new shell in the repo: `echo $AWS_PROFILE` should print your profile, and `node --version` should
print 24.x. `aws sso login` and the AWS SDKs then use that profile automatically.

### Dependencies

```bash
npm install
```

### Local database

Every local tool (drizzle-kit, `npm run db:migrate`, the backend's local scripts, the frontend dev server, docker compose
and the `db-query` skill) reads one file: the repo-root `.env`. No other env file is read.

1. Copy the example and fill in what you need. It points `DATABASE_URL` at the local container. Keep it that way for
   day-to-day work, because a prod `DATABASE_URL` here means local scripts and migrations change real data:

   ```bash
   cp .env.example .env
   ```

2. Start Postgres (pinned to prod's major, 15) and apply the migrations:

   ```bash
   docker compose up -d
   npm run db:migrate
   ```

The container is `sheriff-sale-postgres`, published on `127.0.0.1` only. If port 5432 is taken by another project, set
`POSTGRES_PORT` in `.env` and use the same port in `DATABASE_URL`. If the container won't start because the data
directory was initialised by a newer Postgres major, recreate the volume (local data is disposable; `replay:archive` in
`backend/` can repopulate it):

```bash
docker compose down -v
docker compose up -d
npm run db:migrate
```

Browse the database with `npm run db:studio` (Drizzle Studio).

## Scripts

| Command               | Description                          |
| --------------------- | ------------------------------------ |
| `npm run dev`         | Run all workspaces in dev mode       |
| `npm run build`       | Build all workspaces                 |
| `npm run test`        | Run tests                            |
| `npm run lint`        | Lint with Oxlint (`vp lint`)         |
| `npm run format`      | Format with Oxfmt (`vp fmt`)         |
| `npx vp check`        | Format check and lint, as CI runs it |
| `npm run db:generate` | Generate a migration from the schema |
| `npm run db:migrate`  | Apply migrations                     |
| `npm run db:studio`   | Open Drizzle Studio                  |

## Deploying

Pushes to `main` deploy everything: CI runs the database migrations, applies `infra/` with OpenTofu (which ships the
scraper Lambda bundle), and deploys the frontend to Vercel. To plan or apply infrastructure changes by hand, see
[`infra/README.md`](infra/README.md).

### Migrations

- **Generate them yourself.** After editing `packages/database/src/schema/`, run `npm run db:generate`, review the SQL,
  and commit it with the schema change. Nothing generates migrations for you, and CI fails any branch whose schema has
  changes with no committed migration.
- **Keep each migration expand-only.** CI applies migrations before it deploys the new code, and nothing rolls the
  database back if a deploy then fails. So every migration must work with the code that is already running. Ship a
  destructive change (dropping or renaming a column or table, or adding a constraint the old code can violate) in a
  later deploy than the code that stops using the old shape. For example, deploy the code that no longer reads a
  column first, and drop the column in a following deploy.
