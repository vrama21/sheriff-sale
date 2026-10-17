import { sql } from '@sheriff-sale/database';
import { newJerseySheriffSaleCountyParser } from '../controllers';
import { NJ_COUNTIES } from '../types';

// postgres.js connects lazily, so without this a dead DB would only surface after scraping.
const checkDatabaseConnection = async () => {
  try {
    await sql`SELECT 1`;
  } catch (error) {
    console.error('Database health check failed', error);

    throw new Error('New Jersey Sheriff Sale Scraper aborted: database health check failed.', { cause: error });
  }
};

export async function handler(): Promise<string> {
  await checkDatabaseConnection();

  const results = await Promise.allSettled(NJ_COUNTIES.map((county) => newJerseySheriffSaleCountyParser(county)));

  const failedCounties = NJ_COUNTIES.filter((county, index) => {
    const result = results[index];

    if (result.status === 'rejected') {
      console.error(`New Jersey Sheriff Sale Scraper failed to run for county ${county}.`, result.reason);

      return true;
    }

    return false;
  });

  console.log(
    `New Jersey Sheriff Sale Scraper finished: ${NJ_COUNTIES.length - failedCounties.length}/${
      NJ_COUNTIES.length
    } counties succeeded.`,
  );

  // Throwing marks the invocation failed, so Lambda's async retries and the DLQ engage.
  if (failedCounties.length > 0) {
    throw new Error(
      `New Jersey Sheriff Sale Scraper failed for ${failedCounties.length}/${
        NJ_COUNTIES.length
      } counties: ${failedCounties.join(', ')}.`,
    );
  }

  return 'New Jersey Sheriff Sale Scraper ran successfully.';
}
