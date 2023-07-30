import { newJerseySheriffSaleCountyParser } from '../controllers';
import { NJ_COUNTIES } from '../types';

export async function handler(): Promise<string> {
  await Promise.all(
    NJ_COUNTIES.map(async (county) => {
      try {
        await newJerseySheriffSaleCountyParser(county);
      } catch (error) {
        console.error(error);

        throw new Error('New Jersey Sheriff Sale Scraper failed.');
      }
    }),
  );

  return 'New Jersey Sheriff Sale Scraper ran successfully.';
}
