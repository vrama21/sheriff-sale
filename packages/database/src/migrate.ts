import { config } from 'dotenv';
config({ path: __dirname + '/../../../.env.local' });

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client';

const migrateDb = async () => {
  await migrate(db, { migrationsFolder: __dirname + '/../drizzle' });

  await sql.end();
};

void migrateDb();
