---
name: db-query
description: Run read-only SQL queries against the sheriff-sale Postgres database. Takes an environment flag — `--env local` (the docker-compose postgres container) or `--env prod` (the Railway database) — and otherwise prompts once and reuses that choice for the rest of the session. Use when the user asks to query, count, look up, or inspect listings or status history in the database.
argument-hint: "[--env local|prod] <question or SQL>"
---

# db-query

Run read-only SQL against the sheriff-sale Postgres DB via the bundled wrapper:

```bash
.claude/skills/db-query/scripts/query.sh --env <local|prod> [--json] '<sql>'
```

The script opens every session read-only and runs the SQL in a single `READ ONLY` transaction with a 30s statement timeout, so writes fail.

## Environment selection

Resolve the environment in this order:

1. **Flag in the arguments.** If `$ARGUMENTS` contains `--env local`, `--env prod`, `--env=local` or `--env=prod` (or a bare leading `local` / `prod`), use it and strip it from the request.
2. **Earlier choice this session.** Reuse the environment chosen earlier in the session.
3. **Ask once** with `AskUserQuestion`:
   - Question: "Which database environment should I query?"
   - Header: "DB env"
   - Options:
     - `Local` — The docker-compose `sheriff-sale-postgres` container on `localhost` (`POSTGRES_PORT`, default 5432). Safe for experimentation.
     - `Prod` — The Railway production database. Read-only, but real data — keep queries cheap.

Remember the choice for the rest of the session. Switch only when the user passes a different flag or says so ("use prod", "switch to local"); confirm in one short sentence ("Switched to prod.") and continue.

## Connections

| Env     | Source                                                                                                                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local` | `LOCAL_DATABASE_URL` if set, else `postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:$POSTGRES_PORT/$POSTGRES_DB`, read from the repo-root `.env` (the same file `docker-compose.yml` uses; see `.env.example`). User, port and database default to `postgres`, `5432` and `postgres`. |
| `prod`  | `PROD_DATABASE_URL`, set in `mise.local.toml` under `[env]` (gitignored).                                                                                                                                                                                                                     |

If `local` fails to connect, the container is probably down — tell the user to run `docker compose up -d` rather than retrying. If `prod` says `PROD_DATABASE_URL is not set`, tell the user to add it to `mise.local.toml`; never read it out of `.env` or echo the URL.

## Schema overview

PostgreSQL, managed by Drizzle (`packages/database/src/schema/`, migrations in `packages/database/drizzle/`). Table and column names are **PascalCase / camelCase and must be double-quoted** in SQL: `"Listing"`, `"saleDate"`.

- `"Listing"` — one row per sheriff-sale property. `id text` (UUID string) primary key. Columns: `address`, `attorney`, `attorneyPhone`, `city`, `county`, `courtCase`, `deed`, `deedAddress`, `defendant`, `description`, `judgment`, `latitude`, `longitude`, `mapsUrl`, `parcel`, `plaintiff`, `propertyId int`, `priors`, `saleDate`, `secondaryUnit`, `sheriffId int`, `state`, `street`, `unit`, `upsetAmount`, `zipcode`, `createdAt`, `updatedAt`.
- `"StatusHistory"` — status changes per listing. `id text`, `"listingId"` → `"Listing".id`, `date varchar(12)`, `status`, `createdAt`, `updatedAt`.

Gotchas:

- Most fields are `varchar`, including `saleDate`, `upsetAmount`, `judgment`, `latitude` and `longitude`. Cast explicitly to sort or compare them as dates or numbers (e.g. `to_date("saleDate", 'MM/DD/YYYY')`, `regexp_replace("upsetAmount", '[^0-9.]', '', 'g')::numeric`) — check a few sample values first, since the format comes from the scraper.
- There is no FK constraint on `"listingId"`; join on it, but don't assume every row matches.
- The schema may have drifted from the Drizzle files — confirm columns with `information_schema.columns` before relying on them:

  ```sql
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'Listing'
  ORDER BY ordinal_position;
  ```

## Querying guidance

- **Small result sets.** Add a `LIMIT` (e.g. `LIMIT 50`) unless the user asked for a count or every row.
- **Counts before lists.** For "how many ...", use `SELECT count(*)`.
- **Explicit column lists** instead of `SELECT *` — `"Listing"` is wide.
- **Deterministic order** for "latest", "first", "top N" (e.g. `ORDER BY "createdAt" DESC`).
- Use `--json` when you need to post-process the rows; the default output is a psql table, which is easier to read.
- Pass multi-line SQL with a quoted heredoc on stdin: `query.sh --env local <<'SQL' ... SQL`.

## Output formatting

- Single-row lookups: a short bullet list of the key fields.
- Multi-row results: a compact markdown table with just the columns the user asked about.
- Counts: the number in one short sentence.
- Echo the SQL only if asked, or if it's non-trivial enough to reuse.

## Safety

- Prod: avoid unbounded scans and heavy aggregates without a `LIMIT` or a selective `WHERE`; ask first if unsure.
- Defendant and plaintiff names are public court records, but keep prod output to what the question needs.
- This skill is read-only. If the user asks for a write, decline and point them to a Drizzle migration (`packages/database`) or a one-off script instead.
