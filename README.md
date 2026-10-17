# sheriff-sale

Turborepo monorepo with npm workspaces:

- `backend/`: AWS CDK app and its Lambda sources
- `frontend/`: Next.js app
- `packages/`: shared packages (`database` uses Drizzle, plus shared `config` and `tsconfig`)

## Setup

### mise

[mise](https://mise.jdx.dev) switches the Node version (from `.nvmrc`) and loads this repo's environment variables, such
as `AWS_PROFILE`, when you `cd` into the repo.

1. Install mise and hook it into your shell (for other shells, see the
   [getting started guide](https://mise.jdx.dev/getting-started.html)):

   ```bash
   brew install mise
   echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
   ```

2. Let mise read `.nvmrc` files (off by default):

   ```bash
   mise settings add idiomatic_version_file_enable_tools node
   ```

3. Create `mise.local.toml` in the repo root with your own values. It is gitignored, and mise loads it on top of
   `mise.toml`:

   ```toml
   [env]
   AWS_PROFILE = "<aws profile for this account>"
   # Optional, if you have more than one gh account:
   GH_TOKEN = "{{ exec(command='gh auth token --user <github user>') }}"
   ```

4. Trust the repo's config and install Node:

   ```bash
   mise trust
   mise install
   ```

To check it, open a new shell in the repo: `echo $AWS_PROFILE` should print your profile, and `node --version` should
print 20.x. `aws sso login` and the AWS SDKs then use that profile automatically.

### Dependencies

```bash
npm install
```

## Scripts

| Command               | Description                             |
| --------------------- | --------------------------------------- |
| `npm run dev`         | Run all workspaces in dev mode          |
| `npm run build`       | Build all workspaces                    |
| `npm run deploy`      | Deploy the backend CDK stack            |
| `npm run test`        | Run tests                               |
| `npm run lint`        | Lint                                    |
| `npm run format`      | Format with Prettier                    |
| `npm run db:generate` | Generate Drizzle migrations             |
| `npm run db:migrate`  | Apply migrations                        |
| `npm run db:studio`   | Open Drizzle Studio                     |
