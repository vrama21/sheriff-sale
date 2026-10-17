## 1. Bump

**Never run `db:migrate`, `db:push`, `db:pull` or `db:studio`, or anything else that connects to a database.** The repo's `.env` points at prod. Run drizzle-kit with `DATABASE_URL=postgres://localhost/unused` set in the command.

- [x] 1.1 In `packages/database/package.json`, set `drizzle-orm` to `0.45.3` and `drizzle-kit` to `0.31.11` (exact pins), then run `npm install` at the repo root so `package-lock.json` updates. Confirm that `npm ls drizzle-orm` shows one version across the workspaces.

## 2. No-op generate gate

- [x] 2.1 With no schema edits, run `DATABASE_URL=postgres://localhost/unused npm run db:generate` in `packages/database`. Confirm that it diffs (no "drizzle-kit up" prompt), reports no changes, and that `git status` shows no new files under `drizzle/` and no change to `_journal.json`. If it emits SQL, handle it per design Decision 2: commit cosmetic snapshot rewrites only, and stop and report any real SQL diff.

## 3. Deprecated APIs

- [x] 3.1 In `packages/database/src/schema/listing.ts`, change `pgTable`'s third argument to return `[uniqueIndex('Listing_propertyId_key').on(table.propertyId)]`.
- [x] 3.2 In `packages/database/src/client.ts`, change to `drizzle({ client: sql, schema })`.
- [x] 3.3 Re-run the task 2.1 check. It must still emit no migration.

## 4. Verification

- [x] 4.1 Run `npm run build` and `npm run test` at the repo root, and `npm run lint` in `backend/`, `frontend/` and `packages/database/`. Fix any failures without changing query semantics. Don't run the scraper locally or invoke the Lambda.
- [x] 4.2 Add a throwaway type-level check that `numeric('x', { precision: 12, scale: 2, mode: 'number' })` infers `number | null`, run `tsc --noEmit`, then delete it. Don't commit it.
- [x] 4.3 Run `openspec validate upgrade-drizzle --strict` and fix any issues.
