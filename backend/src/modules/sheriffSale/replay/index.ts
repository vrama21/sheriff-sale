/**
 * Replays archived listing pages from the nj-sheriff-sale bucket into the database through the same parse-and-sync
 * path as the daily scrape. Re-running a range it has already replayed writes nothing.
 *
 * Usage: npm run replay:archive -- [--county <name>]... --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--dry-run]
 *
 * Reads S3 with the ambient AWS credentials: use a profile that can read the bucket and list it (each day's detail
 * pages are listed once, and only archived ones are read). Writes to DATABASE_URL from the repo-root .env, over
 * DATABASE_POOL_MAX connections, default DETAIL_PAGE_CONCURRENCY, so syncs run in parallel. --dry-run reads and parses
 * only, and never connects to the database.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { getS3Text, listS3Keys } from '../../../shared/s3';
import { ARCHIVE_BUCKET_NAME } from '../scrape/saveHtmlToS3';
import { parseReplayArgs, ReplayArgs, USAGE } from './args';
import { DETAIL_PAGE_CONCURRENCY, formatReplaySummary, replayArchive, ReplayDeps } from './replay';

const parseArgsOrExit = (): ReplayArgs => {
  try {
    return parseReplayArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exit(2);
  }
};

const main = async () => {
  const args = parseArgsOrExit();

  config({ path: join(__dirname, '../../../../../.env'), quiet: true });

  const deps: ReplayDeps = {
    readText: (key) => getS3Text({ bucketName: ARCHIVE_BUCKET_NAME, key }),
    listKeys: (prefix) => listS3Keys(ARCHIVE_BUCKET_NAME, prefix),
  };
  let closeDatabase: () => Promise<void> = async () => undefined;

  if (!args.dryRun) {
    // A connection per detail page in flight; the database client reads this when it's imported below.
    process.env.DATABASE_POOL_MAX ??= String(DETAIL_PAGE_CONCURRENCY);

    // Loaded only for a real run: importing the database package creates its client from DATABASE_URL.
    const [{ sql }, { syncListing }] = await Promise.all([
      import('@sheriff-sale/database'),
      import('../ingest/syncListing'),
    ]);

    deps.syncListing = syncListing;
    closeDatabase = async () => sql.end();
  }

  console.log(
    `Replaying ${args.counties.join(', ')} from ${args.dates[0]} to ${args.dates[args.dates.length - 1]}` +
      (args.dryRun ? ' (dry run: nothing is written)' : '') +
      ' ...',
  );

  let summary;

  try {
    summary = await replayArchive(args, deps);
  } finally {
    await closeDatabase();
  }

  formatReplaySummary(summary, args.dryRun).forEach((line) => console.log(line));

  if (summary.failed) {
    console.error('Some reads or syncs failed; see the errors above. Re-running the range is safe.');
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
