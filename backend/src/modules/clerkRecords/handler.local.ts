import { config } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { NJ_COUNTIES, NJCounty } from '../../shared/nj';

// `npm run start:clerkRecords -- [County] [limit]`: looks up one county's due listings (default all four), at most
// `limit` per county (default the run cap), and writes to the DATABASE_URL database. Result pages go to
// CLERK_RECORDS_ARCHIVE_DIR (default <tmpdir>/clerk-records) instead of the S3 bucket, so a local run never writes to
// the deployed archive.
async function local() {
  config({ path: join(__dirname, '../../../../.env'), quiet: true });

  const [countyArg, limitArg] = process.argv.slice(2);
  const county = NJ_COUNTIES.find((name) => name.toLowerCase() === countyArg?.toLowerCase());

  if (countyArg && !county) {
    throw new Error(`Unknown county ${JSON.stringify(countyArg)}`);
  }

  const limit = limitArg ? Number(limitArg) : undefined;

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`The limit must be a positive integer, got ${JSON.stringify(limitArg)}`);
  }

  // Imported after config(): the pipeline loads the database client, which reads DATABASE_URL on import.
  const { runCountyLookups, SUPPORTED_COUNTIES } = await import('./pipeline');
  const { PressClient } = await import('./scrape/platforms/press/pressClient');
  const { resultPageKey } = await import('./scrape/saveResultPageToS3');
  const { sql } = await import('@sheriff-sale/database');
  const counties: NJCounty[] = county ? [county] : SUPPORTED_COUNTIES;
  const archiveDir = process.env.CLERK_RECORDS_ARCHIVE_DIR ?? join(tmpdir(), 'clerk-records');

  console.log(`Archiving result pages under ${archiveDir}`);

  try {
    for (const name of counties) {
      await runCountyLookups(name, {
        limit,
        clientFor: (clientCounty) =>
          PressClient.forCounty(clientCounty, {
            archive: async (page) => {
              const path = join(archiveDir, resultPageKey(page));

              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, page.html);
            },
          }),
      });
    }
  } finally {
    await sql.end();
  }
}

local().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
