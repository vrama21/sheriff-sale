# AGENTS.md

Guidance for coding agents working in this repo. Setup, scripts and deployment are in [`README.md`](README.md),
[`backend/README.md`](backend/README.md) and [`infra/README.md`](infra/README.md). This file covers what those don't:
the rules to follow and the commands that touch real systems.

## What this is

A pipeline that scrapes New Jersey sheriff sale listings from salesweb.civilview.com, plus a site that shows them. A
Turborepo with npm workspaces:

- `backend/`: two Lambdas, bundled with esbuild.
  - `modules/sheriffSale/`: the daily scraper. It archives raw HTML to S3 (`nj-sheriff-sale`) and syncs parsed listings
    to Postgres.
  - `modules/clerkRecords/`: looks up county clerk records (lis pendens and other documents, on the PRESS platform) for
    listings.
- `packages/database/`: Drizzle schema, migrations and client (`@sheriff-sale/database`), used by the backend and the
  frontend from its build in `dist/`.
- `frontend/`: Next.js 14 (pages router) with tRPC, MUI and Emotion.
- `infra/`: OpenTofu for the AWS resources. There is one environment, prod. All testing is local.
- `openspec/`: specs (`openspec/specs/`) and change proposals (`openspec/changes/`).

## Before you call a change done

Run these from the repo root. CI runs the same steps on every branch:

```sh
npx vp check        # format check and lint (Oxfmt + Oxlint, type-aware)
npm run build
npm run test
```

Use `npm run format` to fix formatting. If you changed `packages/database/src/schema/`, also run
`npm run db:generate` (see Database). If you changed `infra/`, run `tofu fmt -recursive` and `tofu validate` in
`infra/`.

## Commands that touch real systems

Ask before you run any of these. Each one changes real data or sends real traffic.

- **`npm run start:newJerseyScraper`** writes to the prod S3 bucket on every run, and to whichever database `.env`'s
  `DATABASE_URL` names.
- **`npm run start:clerkRecords`** sends real requests to county clerk portals and writes to the `DATABASE_URL`
  database.
- **`npm run db:migrate`, `db:push`, `replay:archive`** (without `--dry-run`) write to the `DATABASE_URL` database.
  Check that `.env` points at the local container (`localhost`) first. Never use `db:push`, because migrations are the
  only path for schema changes.
- **`tofu apply`**, and anything else in `infra/` that needs AWS credentials, changes prod. CI applies `infra/` on
  every push to `main`.
- **Pushing to `main`** deploys everything: migrations, both Lambdas and the frontend.

For read-only questions about the data, use the `db-query` skill (`.claude/skills/db-query/`). It opens every session
read-only.

## Backend structure

These rules are specified in `openspec/specs/backend-module-layout/spec.md`:

- `backend/src/` holds only `modules/` and `shared/`.
- Each module keeps its pipeline in stage folders: `scrape/` (fetch and archive raw pages), `parse/` (raw pages to
  typed, validated records) and `ingest/` (database writes). It also has `pipeline.ts`, `index.ts`, and for a deployed
  module, `handler.ts` and `handler.local.ts`. `clerkRecords/` adds `match/`.
- Imports between stages run one way. `scrape/` and `parse/` never import from `ingest/`. No stage imports from
  `pipeline.ts`, `handler.ts` or `replay/`. A type that crosses between stages is defined in the earlier stage.
- Code outside a module imports only from that module's `index.ts`. `index.ts` exports only what outside code uses.
- `shared/` never imports from a module. Code that only one module uses, including its fixtures and scripts, lives in
  that module.
- Store a parsed address as the `Address` type from `shared/address` (`parseAddress`).
- Scraped data is validated with zod (`listingSchema.ts`, `clerkDocumentSchema.ts`). Prefer a runtime check over an
  unchecked cast (`as`).

## Tests

- Tests are colocated as `*.test.ts` and import from `vite-plus/test`, not from `vitest` or Jest. Run them with
  `npm run test`, or `npx vp test run <path>` inside `backend/`.
- Parser tests run against real pages in `__fixtures__/`. Fixtures are byte-for-byte copies of scraped pages. The
  formatter ignores them, and you should never edit, reformat or trim one. To cover a new page shape, add a new fixture
  captured from the real site, and name it after the county and the case (`listingDetailsHudsonUpsetText.html`).
- Test cases built from text on real pages say so (`// Each from an archived page.`). Prefer real text to invented
  text.
- `clerkRecords/ingest/ingest.db.test.ts` runs only when `CLERK_RECORDS_TEST_DATABASE_URL` names a migrated database.
  Nothing else in build or test connects to a database.

## Database

- After you edit `packages/database/src/schema/`, run `npm run db:generate`, review the generated SQL, and commit it
  with the schema change. CI fails a branch whose schema has no matching migration. Never hand-edit
  `packages/database/drizzle/meta/`.
- Migrations must be expand-only. CI applies them before it deploys the new code, and nothing rolls them back. Ship a
  drop, a rename or a new constraint in a later deploy than the code that stops depending on the old shape.
- The backend and frontend use `@sheriff-sale/database` from its build, so run `npm run build` after you change the
  package and before you run `replay:archive` or the frontend.
- The repo-root `.env` is the only env file any local tool reads.

## Code style

- Formatting is Oxfmt from the root `vite.config.ts`: single quotes, semicolons, trailing commas, 120 columns.
- Lint is Oxlint with type-aware rules. Floating or misused promises are errors. Prefix an unused argument with `_`.
- The code uses `const` arrow functions, named exports and camelCase file names that match their main export.
- Comments are sparse. They explain why, or record a fact about the scraped site, rather than restate the code. A short
  JSDoc goes on exported functions and constants whose behavior isn't obvious, and may cite an OpenSpec design decision
  (`(design D9)`).
- The frontend uses its own TypeScript (5.5) and zod (3), and it type-checks without `strictNullChecks`. The backend
  uses TypeScript 7 and zod 4. Don't share zod schemas across that line.
- Pin dependencies to exact versions. GitHub Actions are pinned to a commit SHA, with the release named in a comment.

## OpenSpec

The project is spec-driven. Specs that describe current behavior are in `openspec/specs/<capability>/spec.md`. Proposed
or in-progress work lives in `openspec/changes/<change>/` (`proposal.md`, `design.md`, `tasks.md` and delta specs).
When you implement a change, work through its `tasks.md`, tick tasks as they land, and keep the code consistent with
its design decisions. Use the `openspec-*` skills to propose, apply and archive changes.

## Commits and PRs

Write commit and PR titles as one plain sentence about what changed, in the imperative mood. Describe the behavior,
not the files:

```
Parse Middlesex and Cape May, find free-text upset amounts, alarm on failed runs, and speed up the replay
Drop the blank Attorney File row, and read an upset row that states its amount after the phrase
```

Work on a branch and merge to `main` by PR. GitHub appends the PR number (`(#34)`) on merge.
