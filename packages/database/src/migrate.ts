import { config } from 'dotenv';
config({ path: __dirname + '/../../../.env.local' });

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client';


const migrateDb = async () => {
  // This will run migrations on the database, skipping the ones already applied
  await migrate(db, { migrationsFolder: '../drizzle' });
  // Don't forget to close the connection, otherwise the script will hang
  await sql.end();
};

void migrateDb();
