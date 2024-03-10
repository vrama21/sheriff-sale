import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { config } from 'dotenv';

config({ path: __dirname + '/../../../.env.local' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export * from './schema';
export const sql = postgres(process.env.DATABASE_URL, { max: 1 });
export const db = drizzle(sql, { schema });
