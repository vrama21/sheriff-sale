import { config } from 'dotenv';
import { resolve } from 'path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

config({ path: resolve(__dirname, '../../../.env') });

const migrateDb = async () => {
  // Imported after config() so the client is created from the repo-root .env.
  const { db, sql } = await import('./client');

  try {
    await migrate(db, { migrationsFolder: resolve(__dirname, '../drizzle') });
  } finally {
    await sql.end();
  }
};

migrateDb().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
