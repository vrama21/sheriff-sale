import { config } from 'dotenv';
import { newJerseySheriffSaleCountyParser } from '../../controllers';

async function local() {
  config();

  try {
    await newJerseySheriffSaleCountyParser('Atlantic');
  } catch (error) {
    console.error(error);

    throw error;
  }
}

void local().then(() => process.exit(0));
