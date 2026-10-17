import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Reads the environment only. Local entry points (migrate.ts, drizzle.config.ts, the backend's local scripts) load the
// repo-root .env before importing this module.
const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const sql = postgres(DATABASE_URL, { max: 1 });
export const db = drizzle({ client: sql, schema });
