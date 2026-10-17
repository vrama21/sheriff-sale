import { config } from 'dotenv';
import { join } from 'path';

async function local() {
  config({ path: join(__dirname, '../../../../.env') });

  // Imported after config(): the pipeline loads the database client, which reads DATABASE_URL on import.
  const { newJerseySheriffSaleCountyParser } = await import('./pipeline');

  try {
    await newJerseySheriffSaleCountyParser('Atlantic');
  } catch (error) {
    console.error(error);

    throw error;
  }
}

void local().then(() => process.exit(0));
