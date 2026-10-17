# sheriff-sale

Turborepo monorepo with npm workspaces:

- `backend/`: the scraper Lambda's sources, bundled with esbuild
- `infra/`: OpenTofu config for the AWS resources (see [`infra/README.md`](infra/README.md))
- `frontend/`: Next.js app
- `packages/`: shared packages (`database` uses Drizzle, plus shared `config` and `tsconfig`)

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

## Scripts

| Command               | Description                    |
| --------------------- | ------------------------------ |
| `npm run dev`         | Run all workspaces in dev mode |
| `npm run build`       | Build all workspaces           |
| `npm run test`        | Run tests                      |
| `npm run lint`        | Lint                           |
| `npm run format`      | Format with Prettier           |
| `npm run db:generate` | Generate Drizzle migrations    |
| `npm run db:migrate`  | Apply migrations               |
| `npm run db:studio`   | Open Drizzle Studio            |

## Deploying

Pushes to `main` deploy everything: CI runs the database migrations, applies `infra/` with OpenTofu (which ships the
scraper Lambda bundle), and deploys the frontend to Vercel. To plan or apply infrastructure changes by hand, see
[`infra/README.md`](infra/README.md).
