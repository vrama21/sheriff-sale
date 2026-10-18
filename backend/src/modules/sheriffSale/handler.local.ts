import { config } from 'dotenv';
import { newJerseySheriffSaleCountyParser } from './pipeline';

async function local() {
  config({ quiet: true });

  try {
    await newJerseySheriffSaleCountyParser('Atlantic');
  } catch (error) {
    console.error(error);

    throw error;
  }
}

void local().then(() => process.exit(0));
