import { newJerseySheriffSaleCountyParser } from '../controllers';
import { NJ_COUNTIES } from '../types';

export async function handler(): Promise<string> {
  await Promise.allSettled(
    NJ_COUNTIES.map(async (county) => {
      try {
        await newJerseySheriffSaleCountyParser(county);
      } catch (error) {
        console.error(error);

        throw new Error(`New Jersey Sheriff Sale Scraper failed to run for county ${county}.`);
      }
    }),
  );

  return 'New Jersey Sheriff Sale Scraper ran successfully.';
}
