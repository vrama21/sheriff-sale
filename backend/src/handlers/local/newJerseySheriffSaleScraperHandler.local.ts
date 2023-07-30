import { config } from 'dotenv';
import { newJerseySheriffSaleCountyParser } from '../../controllers';

async function local() {
  config();

  await newJerseySheriffSaleCountyParser('Atlantic').catch((error: Error) => {
    console.error(error);

    throw error;
  });
}

void local();
