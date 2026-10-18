import { sql } from '@sheriff-sale/database';
import { DateTime } from 'luxon';
import { RUN_DEADLINE_MS, runCountyLookups, SUPPORTED_COUNTIES } from './pipeline';

// postgres.js connects lazily, so without this a dead DB would only surface after the first lookups.
const checkDatabaseConnection = async () => {
  try {
    await sql`SELECT 1`;
  } catch (error) {
    console.error('Database health check failed', error);

    throw new Error('New Jersey Clerk Records aborted: database health check failed.', { cause: error });
  }
};

export async function handler(): Promise<string> {
  await checkDatabaseConnection();

  const runStart = DateTime.utc();
  const deadlineAt = runStart.toMillis() + RUN_DEADLINE_MS;

  // Each county is its own host, so they run side by side; within a county, lookups are one at a time.
  const results = await Promise.allSettled(
    SUPPORTED_COUNTIES.map((county) => runCountyLookups(county, { runStart, deadlineAt })),
  );

  const failedCounties = SUPPORTED_COUNTIES.filter((county, index) => {
    const result = results[index];

    if (result.status === 'rejected') {
      console.error(`New Jersey Clerk Records failed for county ${county}.`, result.reason);

      return true;
    }

    return false;
  });

  console.log(
    `New Jersey Clerk Records finished: ${SUPPORTED_COUNTIES.length - failedCounties.length}/${
      SUPPORTED_COUNTIES.length
    } counties succeeded.`,
  );

  // Throwing marks the invocation failed, so the DLQ engages.
  if (failedCounties.length > 0) {
    throw new Error(
      `New Jersey Clerk Records failed for ${failedCounties.length}/${SUPPORTED_COUNTIES.length} counties: ${failedCounties.join(', ')}.`,
    );
  }

  return 'New Jersey Clerk Records ran successfully.';
}
