/**
 * Replays archived listing pages from the nj-sheriff-sale bucket into the database through the same parse-and-sync
 * path as the daily scrape. Re-running a range it has already replayed writes nothing.
 *
 * Usage: npm run replay:archive -- [--county <name>]... --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--dry-run]
 *
 * Reads S3 with the ambient AWS credentials: use a profile that can read the bucket and list it, or a missing page
 * counts as a failed read instead of missing. Writes to DATABASE_URL from the repo-root .env. --dry-run reads and
 * parses only, and never connects to the database.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { getS3Text } from '../../../shared/s3';
import { ARCHIVE_BUCKET_NAME } from '../scrape/saveHtmlToS3';
import { parseReplayArgs, ReplayArgs, USAGE } from './args';
import { formatReplaySummary, replayArchive, ReplayDeps } from './replay';

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
  };
  let closeDatabase: () => Promise<void> = async () => undefined;

  if (!args.dryRun) {
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
