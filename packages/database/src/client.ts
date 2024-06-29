import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { config } from 'dotenv';

config({ path: __dirname + '/../../../.env' });

const {DATABASE_URL} = process.env;

  if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const sql = postgres(DATABASE_URL, { max: 1 });
export const db = drizzle(sql, { schema });
